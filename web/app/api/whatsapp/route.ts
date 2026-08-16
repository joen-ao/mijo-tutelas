import { NextResponse } from "next/server";

import { interpretarSiNo } from "@/lib/afirmaciones";
import { armarTutela, fraseEstadistica } from "@/lib/armarTutela";
import { correoDisponible, enviarTutelaAlUsuario, radicarPorCorreo, resolverReparto } from "@/lib/correo";
import {
  agendarSeguimiento, leerDesenlace, marcarSeguimiento, mensajeDeSeguimiento,
  respuestaAlDesenlace, seguimientoDe,
} from "@/lib/seguimiento";
import { construirPeticion, guardarPeticion, vencimiento } from "@/lib/peticion";
import { resolverCorreoEps } from "@/lib/correoPeticion";
import { estructurar } from "@/lib/prompts/estructurar";
import { triajePorDefecto, triar } from "@/lib/prompts/triaje";
import { guardarPdf, subirPdf } from "@/lib/pdfStore";
import { llamadasListas, llamarYLeerTutela, pideLlamada } from "@/lib/llamada";
import { obtenerTutela } from "@/lib/tutela";
import { generarTutelaPdf } from "@/lib/tutelaPdf";
import { guardarAudio } from "@/lib/audioStore";
import { extraerCampos, frasearSiguiente } from "@/lib/conversacion";
import { perfilarLead } from "@/lib/flow";
import {
  PREGUNTA_MEDIO, detectarMedio, dormir, horasLegibles, humanizar, paraVoz, partirMensaje,
  pausaDeTecleo, soloEligioMedio,
} from "@/lib/mensajes";
import { subirAudio } from "@/lib/storage";
import { createLead, getLead } from "@/lib/store";
import type { Caso } from "@/lib/types";
import { transcribirAudioTwilio } from "@/lib/stt";
import { sintetizarVoz, ttsDisponible, voiceIdPorCiudad } from "@/lib/tts";
import { debeVerificarFirma, firmaValida, urlPublica } from "@/lib/twilioFirma";
import { enviarWhatsApp, enviarWhatsAppDetalle, esperarEntregaWhatsApp, mostrarEscribiendo, twilioListo } from "@/lib/twilioSend";

/**
 * T19/T20 · Webhook de Twilio WhatsApp — conversación con Gemini + voz.
 *
 * ENTREGA ASÍNCRONA: el webhook responde al instante (TwiML vacío) y el mensaje
 * real —que puede tardar por Gemini + TTS— se envía después por la API de Twilio.
 * Así nunca se topa con el timeout de 15s. Si no hay credenciales de Twilio (p. ej.
 * pruebas locales con curl), cae a la entrega síncrona por TwiML.
 *
 * El CEREBRO decide qué falta (perfilarLead) y el MODELO puntúa; GEMINI conversa.
 * Estado por teléfono en memoria (Redis en prod). Va en el web por el cruce (A1).
 */

interface Sesion {
  leadId: string; pendingCampo: string | null; lastPregunta: string;
  // "espera_radicacion" = ya tiene el PDF y le preguntamos si radicamos por ella.
  // "entregada" = cerrado; lo que escriba después es seguimiento.
  fase?: "espera_radicacion" | "espera_seguimiento" | "entregada";
  /** El seguimiento que está esperando respuesta. */
  seguimientoId?: string;
  /* Lo mínimo para radicar en el turno siguiente, si dice que sí. El PDF se
   * referencia por id (vive en pdfStore) para no cargar el buffer en la sesión. */
  radicacion?: {
    tutelaId: string; ciudad: string; nombre: string; cedula: string;
    accionado: string; derechos: string[]; correo: string;
  };
  // Cómo quiere que le hablemos (se lo preguntamos en el saludo, T25).
  prefMedio?: "audio" | "texto" | null;
  esperaMedio?: boolean;
}
interface Spec {
  mensaje: string; esVoz: boolean; textoExtra?: string;
  // El PDF de la tutela. Va ANTES que todo lo demás (ver entregarAsync).
  // pdfUrl = Supabase (estable); si no hay, se sirve local por /api/pdf.
  pdfId?: string; pdfUrl?: string; pdfCaption?: string;
}
interface Media { num: number; type: string; url: string }
// Buffer de "ráfaga": junta los mensajes que la persona manda seguidos para
// leerlos TODOS juntos y responder una sola vez, como un asesor de verdad.
// `sid` = último MessageSid entrante: lo necesita el indicador de "escribiendo".
interface Buffer { partes: string[]; timer: ReturnType<typeof setTimeout> | null; baseUrl: string; sid: string }

const g = globalThis as unknown as {
  __waSesiones?: Map<string, Sesion>;
  __waSeen?: Set<string>;
  __waColas?: Map<string, Promise<unknown>>;
  __waBuffers?: Map<string, Buffer>;
  __waVoces?: Map<string, string>;
};
const sesiones = g.__waSesiones ?? (g.__waSesiones = new Map());
const vistos = g.__waSeen ?? (g.__waSeen = new Set());
// Cola por número: serializa los mensajes de un MISMO teléfono para que dos
// mensajes en ráfaga no pisen `respuestas` (read-modify-write) ni la sesión.
const colas = g.__waColas ?? (g.__waColas = new Map());
// Ventana de "espera a que termines de escribir" (ms). Un asesor real no
// responde a cada burbuja: lee toda tu ráfaga y contesta una vez.
const buffers = g.__waBuffers ?? (g.__waBuffers = new Map());
// Voz (voice_id de ElevenLabs) por número: el acento de la ciudad de la persona.
// Vive aparte de la sesión para sobrevivir a su borrado (cierre/cita).
const voces = g.__waVoces ?? (g.__waVoces = new Map());
const DEBOUNCE_MS = Number(process.env.WHATSAPP_DEBOUNCE_MS ?? 1800);
// Twilio ENTREGA la media (audio/imagen) más lento que el texto (tiene que
// buscar el archivo), así que el texto le "gana" al audio aunque lo mandemos
// después. Le damos al media una ventaja antes de soltar el texto que lo sigue.
const PAUSA_TRAS_MEDIA_MS = Number(process.env.WHATSAPP_PAUSA_MEDIA_MS ?? 3500);
const SIN_MEDIA: Media = { num: 0, type: "", url: "" };

function encolar<T>(from: string, fn: () => Promise<T>): Promise<T> {
  const prev = colas.get(from) ?? Promise.resolve();
  const next = prev.then(fn, fn); // corre pase lo que pase con el anterior
  colas.set(from, next.then(() => {}, () => {})); // tail que nunca rechaza → la cola sigue viva
  return next;
}

/** Marca un MessageSid como visto (idempotencia) y acota el Set para no fugar memoria. */
function marcarVisto(sid: string): void {
  vistos.add(sid);
  if (vistos.size > 2000) {
    const it = vistos.values();
    for (let i = 0; i < 1000; i++) { const v = it.next(); if (v.done) break; vistos.delete(v.value); }
  }
}

/**
 * ¿La respuesta de este turno va a ser una nota de voz?
 *
 * Importa por el indicador: WhatsApp solo expone "escribiendo…", no existe un
 * "grabando audio". Mostrar "escribiendo" y mandar un audio es mentirle a la
 * persona, así que cuando sabemos que va audio NO se muestra nada.
 *
 * Primer contacto (sin sesión) = saludo por voz. Después manda su preferencia.
 */
function respondeConVoz(from: string, texto: string): boolean {
  const sesion = sesiones.get(from);
  if (!sesion) return true;              // el saludo siempre va en audio
  if (sesion.prefMedio === "audio") return true;
  // Turno en el que justo está eligiendo: si dice "audio", la respuesta ya va a
  // ser una nota de voz aunque la sesión todavía no lo tenga guardado.
  if (sesion.esperaMedio && detectarMedio(texto) === "audio") return true;
  return false;
}

/**
 * Mantiene el "escribiendo…" prendido mientras pensamos (Gemini puede tardar).
 * El indicador de WhatsApp expira a los 25 s, así que se repite.
 * Devuelve la función para apagarlo.
 */
function tecleandoMientrasTanto(sid: string): () => void {
  if (!sid) return () => {};
  void mostrarEscribiendo(sid);
  const t = setInterval(() => void mostrarEscribiendo(sid), 20_000);
  return () => clearInterval(t);
}

/** Procesa UN turno (texto ya combinado) y entrega la respuesta, serializado por from. */
function encolarTurno(from: string, texto: string, media: Media, baseUrl: string, sid: string): void {
  void encolar(from, async () => {
    // Si la respuesta va a ser audio, no se muestra "escribiendo" (ver arriba).
    const parar = respondeConVoz(from, texto) ? () => {} : tecleandoMientrasTanto(sid);
    try {
      const s = await computarRespuesta(from, texto, media);
      await entregarAsync(from, s, baseUrl, sid);
    } finally { parar(); }
  }).catch(async (e) => {
    console.error("[whatsapp async]", e);
    try {
      await enviarWhatsApp(from, { body: "Uy, se me enredó algo procesando tu mensaje. ¿Me lo repites?" });
    } catch { /* nada más que hacer */ }
  });
}

/** Cierra la ráfaga de un número: junta lo acumulado y lo procesa como un turno. */
function flushBuffer(from: string): void {
  const b = buffers.get(from);
  if (!b) return;
  if (b.timer) clearTimeout(b.timer);
  buffers.delete(from);
  const texto = b.partes.join("\n").trim();
  if (texto) encolarTurno(from, texto, SIN_MEDIA, b.baseUrl, b.sid);
}

function xmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function twimlVacio(): NextResponse {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
}
const spec = (mensaje: string, esVoz = false, textoExtra?: string): Spec => ({ mensaje, esVoz, textoExtra });

const q = (ml: Record<string, unknown> | null) => (ml?.next_question as { campo?: string; texto?: string }) ?? {};


/**
 * Arma y entrega el DERECHO DE PETICIÓN cuando el triaje dice que esa es la vía.
 *
 * Devuelve null si algo falla, y entonces quien llama sigue con la tutela: es
 * peor camino que el correcto, pero es un camino, y nadie se queda sin nada.
 *
 * No hay recuperación de jurisprudencia ni verificador acá, y no es un olvido:
 * un derecho de petición no cita sentencias. Su fuerza está en el artículo 23
 * de la Constitución y en el reloj que arranca cuando se radica.
 */
async function armarPeticion(
  from: string, sesion: Sesion, relato: string,
  triaje: { tipo_peticion: "general" | "documentos_informacion" | "consulta"; motivo: string },
): Promise<Spec | null> {
  try {
    const lead = await getLead(sesion.leadId);
    const resp = (lead?.respuestas ?? {}) as Record<string, unknown>;
    const str = (k: string) => String(resp[k] ?? "").trim();

    const est = await estructurar(relato, resp).catch(() => null);
    if (!est) return null;

    const nombreEps = str("accionado") || est.accionado.nombre;
    const eps = resolverCorreoEps(nombreEps);

    const doc = construirPeticion({
      hechos: est.hechos,
      tipo: triaje.tipo_peticion,
      entidad: { nombre: nombreEps, tipo: est.accionado.tipo, correo: eps?.correo ?? null },
      peticionario: {
        nombre: est.accionante.nombre || str("nombre"),
        cedula: est.accionante.cedula || str("cedula"),
        ciudad: est.accionante.ciudad || str("ciudad"),
        telefono: from.replace(/^whatsapp:/, ""),
        correo: str("correo").includes("@") ? str("correo") : "",
      },
      que_pide: str("que_negaron"),
      diagnostico: str("diagnostico") || null,
    });

    const peticionId = guardarPeticion(doc);
    const pdf = await generarTutelaPdf(peticionId, true, "peticion");
    if (!pdf) return null;

    const plazo = vencimiento(doc);
    const vence = plazo.fecha.toISOString().slice(0, 10);

    /* Se agenda el seguimiento con SU plazo, no con los 10 días de la tutela.
     * Cuando se venza, el bot vuelve — y ahí la tutela por violación del
     * derecho de petición prospera casi siempre. */
    await agendarSeguimiento({
      casoId: sesion.leadId, telefono: from, tipo: "peticion",
      ciudad: doc.peticionario.ciudad, accionado: nombreEps, diasPeticion: plazo.dias,
    }).catch(() => {});

    sesiones.set(from, { ...sesion, fase: "entregada", pendingCampo: null });

    const s = spec(
      `Antes de la tutela te sirve más un derecho de petición. ${triaje.motivo} `
      + `Es gratis, no necesitas juez, y ${nombreEps || "tu EPS"} está obligada a responderte por escrito.`,
      true,
      `⏱️ Tienen *${plazo.dias} días hábiles* para responderte desde que la radiques `
      + `(artículo 14 de la Ley 1755 de 2015). Si la radicas hoy, se les vence cerca del *${vence}*.\n\n`
      + (eps?.correo
        ? `Puedes enviarla a ${eps.correo} o llevarla en persona.`
        : "Llévala a la oficina de atención al usuario de tu EPS y pide que te sellen una copia: "
          + "ese sello es la prueba de que la radicaste.")
      + "\n\nCuando se venza el plazo te escribo. Si no te respondieron, ahí sí armamos la tutela — "
      + "y llegas con la prueba de que pediste primero.",
    );
    s.pdfId = guardarPdf(pdf);
    s.pdfUrl = (await subirPdf(pdf)) ?? undefined;
    s.pdfCaption = "📄 Tu derecho de petición, listo para imprimir y radicar.";
    return s;
  } catch (e) {
    console.error("[whatsapp] armarPeticion:", e);
    return null;
  }
}

/** Todo lo que la persona ha contado, para que armarTutela lo lea entero. */
function relatoAcumulado(lead: Caso): string {
  return String((lead.respuestas as Record<string, unknown>)?.relato ?? "");
}

/** Toda la lógica del turno → devuelve QUÉ responder (texto o voz). */
async function computarRespuesta(
  from: string, body0: string, media: { num: number; type: string; url: string },
): Promise<Spec> {
  let body = body0;

  // 🎙️ Nota de voz entrante → transcribir con Scribe
  if (media.num > 0 && media.type.startsWith("audio")) {
    const texto = await transcribirAudioTwilio(media.url, media.type);
    if (!texto) return spec("Uy, no logré escuchar bien tu nota de voz. ¿Me la repites o me la escribes?");
    body = texto;
  }

  // 🧹 Reiniciar conversación (útil para demo: probar varios casos desde el
  // mismo número sin arrastrar las respuestas de la prueba anterior).
  if (/^\s*(reiniciar|reinicio|reset|empezar de nuevo|nueva prueba|borrar)\b/i.test(body)) {
    sesiones.delete(from);
    return spec("Listo, empezamos de cero. Cuéntame qué te negó tu EPS.");
  }

  const sesion = sesiones.get(from);

  // --- Primer contacto ---
  if (!sesion) {
    const lead = await createLead({ canal: "whatsapp", nombre: null, telefono: from, email: null, cedula: null, consentimiento: true });
    voces.set(from, voiceIdPorCiudad(null)); // se afina cuando diga su ciudad
    const ml = await perfilarLead(lead.id, {});
    const nq = q(ml);
    const saludo = "Hola, soy Mijo. Si tu EPS te negó un medicamento, un examen, una cirugía o una cita, "
      + "te armo la acción de tutela para que la radiques. No necesitas abogado y no te cuesta nada.";
    const msg = await frasearSiguiente(saludo, null, nq.campo ?? "", nq.texto ?? "");
    sesiones.set(from, {
      leadId: lead.id, pendingCampo: nq.campo ?? null,
      // Solo la PREGUNTA (no el saludo): si toca repetirla al elegir audio/texto,
      // repetir el saludo entero sonaría a disco rayado.
      lastPregunta: humanizar(nq.texto ?? msg, 0),
      prefMedio: null, esperaMedio: true,
    });
    // El saludo entra por VOZ (es lo que engancha) y la pregunta del medio va
    // detrás, en texto, para que se pueda leer y responder sin escuchar el audio.
    return spec(msg, true, PREGUNTA_MEDIO);
  }

  const lead = await getLead(sesion.leadId);
  if (!lead) { sesiones.delete(from); return spec("Reiniciemos: escríbeme de nuevo."); }

  // --- ¿Contestó si prefiere audio o texto? (se lo preguntamos en el saludo) ---
  if (sesion.esperaMedio) {
    const medio = detectarMedio(body);
    if (medio) {
      sesion.prefMedio = medio;
      sesion.esperaMedio = false;
      sesiones.set(from, sesion);
      // Si SOLO eligió el medio, no hay nada que extraer todavía: acusamos
      // recibo y repetimos la pregunta que quedó pendiente.
      if (soloEligioMedio(body)) {
        const ack = medio === "audio"
          ? "Listo, te mando notas de voz."
          : "Listo, te escribo por acá.";
        return spec(`${ack}\n\n${sesion.lastPregunta}`, medio === "audio");
      }
      // Dijo el medio Y algo más: seguimos el flujo normal con el mismo mensaje.
    } else if (!soloEligioMedio(body)) {
      // Se saltó la pregunta y fue al grano: no insistimos.
      sesion.esperaMedio = false;
      sesiones.set(from, sesion);
    }
  }

  /* --- "Llámame": Mijo lee la tutela por teléfono -------------------------
   *
   * Para quien no lee bien, no sabe abrir un PDF o simplemente prefiere que le
   * hablen. Es otro número y otra API de Twilio, así que NO gasta cuota de
   * mensajes de WhatsApp. */
  if (pideLlamada(body)) {
    const r = sesion.radicacion;
    const doc = r ? obtenerTutela(r.tutelaId) : null;
    if (!doc) {
      return spec(
        "Todavía no tengo tu tutela lista para leértela. Terminemos de armarla y "
        + "después te llamo con gusto.",
      );
    }
    if (!llamadasListas()) {
      return spec("Por ahora no puedo llamarte, pero el documento y la explicación ya los "
        + "tienes por aquí. ¿Qué parte te aclaro?");
    }
    const oficina = resolverReparto(doc.accionante.ciudad);
    const res = await llamarYLeerTutela(from, doc, { oficina: oficina?.oficina ?? null });
    return spec(
      res.ok
        ? "📞 Te estoy llamando ahora mismo. Contesta y te leo la tutela con calma."
        : "Intenté llamarte y no pude. Tranquilo: el documento ya es tuyo y aquí te "
          + "explico lo que necesites.",
    );
  }

  /* --- Comando de demo: dispara el seguimiento sin esperar 10 días ---------
   * Existe para poder GRABARLO. Un recordatorio que llega a los 10 días hábiles
   * es imposible de mostrar en un video de un minuto, y es de las partes más
   * valiosas del producto. Está documentado en el README. */
  if (/^\s*simular seguimiento\b/i.test(body)) {
    const seg = await seguimientoDe(from);
    if (!seg) {
      return spec(
        "Todavía no tienes nada radicado, así que no hay seguimiento que simular. "
        + "Radica una tutela primero.",
      );
    }
    await marcarSeguimiento(seg.id, { estado: "avisado", avisado_at: new Date().toISOString() });
    sesiones.set(from, { ...sesion, fase: "espera_seguimiento", seguimientoId: seg.id });
    return spec(mensajeDeSeguimiento(seg));
  }

  /* --- Contestó al aviso de seguimiento --------------------------------- */
  if (sesion.fase === "espera_seguimiento") {
    const seg = await seguimientoDe(from);
    const d = leerDesenlace(body);
    const ctx = seg ?? ({ accionado: null } as never);
    if (d === "no_claro") return spec(respuestaAlDesenlace(d, ctx));

    if (seg) {
      await marcarSeguimiento(seg.id, {
        estado: d === "cumplido" ? "cerrado" : "respondido",
        respuesta: `${d}: ${body.slice(0, 200)}`,
      });
    }
    sesiones.set(from, { ...sesion, fase: "entregada", seguimientoId: undefined });
    return spec(respuestaAlDesenlace(d, ctx), true);
  }

  /* --- Le preguntamos si radicamos por ella. Este turno es SOLO para eso ---
   *
   * Nadie radica un documento judicial en nombre de otro sin que esa persona lo
   * autorice en ese momento. No basta con que haya pedido la tutela: radicar
   * abre un proceso, fija términos y la deja notificada. Por eso es una
   * pregunta aparte y explícita, y el "no" es tan válido como el "sí". */
  if (sesion.fase === "espera_radicacion") {
    const r = sesion.radicacion;
    /* Reglas primero, Gemini para desempatar (ver lib/afirmaciones.ts). La lista
     * blanca de confirmaciones cortas leía "Radícala por mí ante la oficina de
     * Medellín" —el consentimiento más explícito posible— como un no. */
    const intencion = await interpretarSiNo(
      body,
      `¿Quieres que radique tu tutela ante la Oficina Judicial de Reparto de ${r?.ciudad ?? "tu ciudad"}?`,
    );

    /* Ambiguo NO es un no: se repregunta y se conserva la sesión. Decidir en
     * silencio sobre un acto irreversible es peor que preguntar dos veces. */
    if (intencion === "ambiguo") {
      return spec(
        "Perdón, no te entendí bien. ¿Quieres que yo la radique por ti ante el juzgado? "
        + "Respóndeme *sí* o *no* — si prefieres llevarla tú, también está perfecto.",
      );
    }

    sesiones.set(from, { ...sesion, fase: "entregada", radicacion: undefined });

    if (intencion === "no") {
      return spec(
        "Listo, no la radico. El PDF ya es tuyo: la puedes llevar a cualquier juzgado "
        + "o subirla al portal cuando quieras. En el correo te dejé el paso a paso.",
      );
    }
    if (!r) return spec("Se me venció el documento. Escríbeme *reiniciar* y lo armamos de nuevo.");

    /* Se REIMPRIME sin el instructivo. El PDF que tiene la persona lleva la hoja
     * de "qué hacer con este documento", que para ella es lo más útil y para un
     * juzgado es ruido: al reparto va el escrito judicial y nada más. */
    const doc = obtenerTutela(r.tutelaId);
    const pdf = await generarTutelaPdf(r.tutelaId, false);
    if (!pdf || !doc) {
      return spec(
        "Se me venció el expediente antes de alcanzar a radicarlo. Escríbeme *reiniciar* "
        + "y lo hacemos otra vez, no te preocupes.",
      );
    }

    const rad = await radicarPorCorreo({
      ciudad: r.ciudad,
      accionante: { nombre: r.nombre, cedula: r.cedula },
      accionado: r.accionado,
      derechos: r.derechos,
      pdf,
      nombreArchivo: "accion-de-tutela.pdf",
    });

    /* A los 10 días hábiles le escribimos para preguntar qué pasó. Es lo que
     * ningún abogado hace y lo que hace falta: la gente gana la tutela y se
     * queda esperando porque nadie le dijo que ganar no basta (art. 52). */
    await agendarSeguimiento({
      casoId: sesion.leadId,
      telefono: from,
      tipo: "tutela",
      ciudad: r.ciudad,
      accionado: r.accionado,
    }).catch((e) => console.error("[whatsapp] agendar seguimiento:", e));

    /* La copia para la persona lleva EL MISMO `pdf` que recibió el juzgado, no
     * una reimpresión con instructivo. Si el archivo no es idéntico deja de ser
     * una constancia y pasa a ser otro documento: el sentido de esta copia es
     * poder abrirla y ver exactamente qué se radicó. */
    let copiaEnviada = false;
    if (rad.ok && r.correo && correoDisponible()) {
      const copia = await enviarTutelaAlUsuario({
        para: r.correo,
        nombre: r.nombre,
        pdf,
        nombreArchivo: "tutela-radicada.pdf",
        kit: {
          doc,
          correoUsuario: r.correo,
          telefono: from.replace(/^whatsapp:/, ""),
          reparto: resolverReparto(r.ciudad),
        },
        constancia: {
          oficina: rad.oficina ?? r.ciudad,
          destinatarioReal: rad.destinatarioReal ?? "—",
          destinatarioUsado: rad.destinatarioUsado,
          idEnvio: rad.id,
          // Si el correo no salió al juzgado real, la constancia lo dice.
          esPrueba: rad.destinatarioReal !== rad.destinatarioUsado[0],
        },
      }).catch((e) => { console.error("[whatsapp] copia al usuario:", e); return null; });
      copiaEnviada = Boolean(copia?.ok);
    }

    if (!rad.ok) {
      const oficina = resolverReparto(r.ciudad);
      return spec(
        `No pude radicarla por correo${rad.error ? ` (${rad.error})` : ""}. `
        + (oficina
          ? `Puedes enviarla tú a ${oficina.correo}, o `
          : "Puedes ")
        + "subirla en procesojudicial.ramajudicial.gov.co/TutelaEnLinea. Te dejé el paso a paso en el correo.",
      );
    }

    return spec(
      `✅ Radicada ante la *${rad.oficina}*.\n\n`
      + `Comprobante de envío: ${rad.id}\n\n`
      + (copiaEnviada
        ? `📧 Te mandé a *${r.correo}* una copia del documento EXACTO que recibió el juzgado, `
          + "con la constancia del envío. Guárdala.\n\n"
        : "")
      + "El juzgado te va a escribir con el número de radicado. A partir de ahí corren "
      + "los 10 días que tiene el juez para fallar.",
      true,
    );
  }

  // --- Ya tiene su tutela: lo que escriba ahora es seguimiento ---
  if (sesion.fase === "entregada") {
    const { duda } = await extraerCampos(body, "");
    return spec(
      duda ?? "Tu tutela ya está lista y te la mandé en PDF. Si necesitas otra por un caso distinto, "
        + "escríbeme *reiniciar* y la armamos desde cero.",
    );
  }

  // --- Extracción MÚLTIPLE: saca todos los datos del mensaje + responde dudas ---
  const { campos, duda } = await extraerCampos(body, sesion.pendingCampo ?? "");

  // El acento sigue a la ciudad, apenas la sepamos.
  if (typeof campos.ciudad === "string") voces.set(from, voiceIdPorCiudad(campos.ciudad));

  // El relato crudo se conserva aparte de los campos: es lo que lee el modelo
  // para redactar los hechos, y ahí está el matiz que ningún campo captura.
  const relato = [relatoAcumulado(lead), body].filter(Boolean).join("\n");

  const ml = await perfilarLead(sesion.leadId, { ...campos, relato });
  if (!ml) return spec("Tuve un problema, ¿me repites?");

  if (ml.status === "qualified") {
    if (ml.ruteo === "no_es_via_de_tutela") {
      sesiones.delete(from);
      return spec(
        "Por lo que me cuentas, esto no se resuelve con una tutela de salud, y prefiero decírtelo "
        + "a armarte un documento que no te va a servir. Lo mío son las negativas de la EPS: "
        + "medicamentos, exámenes, cirugías, citas y tratamientos.",
        true,
      );
    }

    /* Armar la tutela toma entre 15 y 25 segundos (clasificar, estructurar,
     * recuperar, redactar, verificar e imprimir). Ese silencio en WhatsApp se
     * lee como que el bot se colgó, así que se avisa ANTES de empezar. Se manda
     * directo y no por el Spec porque el Spec es la respuesta del turno, que
     * es justo la que va a tardar. */
    await enviarWhatsApp(from, {
      body: "Perfecto, ya tengo todo. Dame un momento que estoy armando tu tutela y buscando "
        + "las sentencias de la Corte que se parecen a tu caso… 📄",
    }).catch(() => { /* si falla el aviso, igual seguimos */ });

    /* ── TRIAJE: ¿tutela o derecho de petición? ────────────────────────────
     *
     * Si la persona nunca le pidió nada formalmente a la EPS y no hay urgencia
     * vital, la vía correcta NO es la tutela: es un derecho de petición. Es más
     * rápido, muchas veces resuelve, y si no resuelve deja algo que la tutela
     * necesita — la prueba de que se pidió y no contestaron.
     *
     * Mandar a todo el mundo directo a tutela sería más vistoso y peor consejo.
     *
     * El código le gana al modelo en un solo sentido: si detecta urgencia vital
     * (diálisis, quimio, oxígeno, trasplante) fuerza tutela aunque el modelo
     * haya dicho petición. Nunca al revés. Mandar a esperar 15 días hábiles a
     * alguien en diálisis es exactamente el daño que la tutela existe para
     * evitar. */
    const triaje = (await triar(relato).catch(() => null)) ?? triajePorDefecto(relato);
    if (triaje.via_recomendada !== "tutela") {
      const spec2 = await armarPeticion(from, sesion, relato, triaje);
      if (spec2) return spec2;
      // Si la petición no se pudo armar, se sigue con la tutela: es peor camino
      // pero es un camino, y la persona no se queda sin nada.
    }

    const leadFinal = await getLead(sesion.leadId);
    const armado = await armarTutela(
      relato,
      (leadFinal?.respuestas ?? {}) as Record<string, unknown>,
      from.replace(/^whatsapp:/, ""), // va en NOTIFICACIONES
    );

    if (armado.estado === "fuera_de_alcance") {
      sesiones.delete(from);
      return spec(
        "Revisando lo que me contaste, esto no es una tutela de salud contra una EPS, "
        + "que es lo único que sé hacer bien. Prefiero decírtelo de frente.",
        true,
      );
    }
    if (armado.estado === "fallo") {
      console.error("[whatsapp] armarTutela:", armado.motivo);
      return spec(
        "Uy, se me atravesó un problema armando el documento. ¿Me escribes *reiniciar* "
        + "y lo intentamos otra vez? No perdimos nada de lo que me contaste.",
      );
    }

    const doc = armado.doc;
    const correoPersona = String(leadFinal?.respuestas?.correo ?? "").trim();
    const oficina = resolverReparto(doc.accionante.ciudad);

    /* El correo NO se manda aquí. La persona acaba de recibir el PDF por
     * WhatsApp y el instructivo va dentro del propio documento: mandarle lo
     * mismo por otro canal es ruido. El correo se manda cuando de verdad
     * aporta algo distinto — al radicar, como constancia de lo que se envió y
     * a dónde. */
    const avisoCorreo = "";

    /* Si el caso es urgente se le DICE, y antes de cualquier otra cosa. Que el
     * juez pueda ordenar la atención sin esperar los diez días es justo lo que
     * la gente no sabe, y es la diferencia entre aguantar dos semanas más o no.
     * Va en el texto y no solo en el PDF porque el PDF muchos no lo abren. */
    const avisoUrgencia = armado.doc.medida_provisional
      ? "\n\n⚡ *Tu caso es urgente.* Le pedí al juez una medida provisional: que ordene "
        + "la atención de inmediato, sin esperar los 10 días del fallo (artículo 7 del "
        + "Decreto 2591 de 1991). Cuando la radiques, dilo en voz alta en la ventanilla."
      : "";

    /* La pregunta del consentimiento. Se hace SIEMPRE por separado y en este
     * turno, no antes: recién ahora la persona tiene el documento en la mano y
     * puede decidir con algo concreto enfrente. */
    let pregunta = "";
    if (oficina && correoDisponible()) {
      sesiones.set(from, {
        ...sesion, fase: "espera_radicacion", pendingCampo: null,
        radicacion: {
          tutelaId: armado.tutelaId,
          ciudad: doc.accionante.ciudad,
          nombre: doc.accionante.nombre,
          cedula: doc.accionante.cedula,
          accionado: doc.accionado.nombre,
          derechos: doc.derechos_vulnerados,
          correo: correoPersona.includes("@") ? correoPersona : "",
        },
      });
      pregunta = `\n\n¿Quieres que la radique por ti ante la *${oficina.oficina}*? `
        + "Respóndeme *sí* o *no*. Si prefieres llevarla tú, también está perfecto."
        + (llamadasListas() ? "\n\n📞 Y si prefieres que te lo explique hablando, escríbeme *llámame*." : "");
    } else {
      sesiones.set(from, {
        ...sesion, fase: "entregada", pendingCampo: null,
        // Se guarda igual para que "llámame" funcione aunque no haya reparto.
        radicacion: {
          tutelaId: armado.tutelaId, ciudad: doc.accionante.ciudad,
          nombre: doc.accionante.nombre, cedula: doc.accionante.cedula,
          accionado: doc.accionado.nombre, derechos: doc.derechos_vulnerados,
          correo: correoPersona.includes("@") ? correoPersona : "",
        },
      });
    }

    // 📄 PDF primero, 🔊 la nota de voz explicándolo, 💬 y el texto al final.
    const s = spec(
      duda ? `${duda}\n\n${armado.guionVoz}` : armado.guionVoz,
      true,
      fraseEstadistica(armado.estadistica, armado.verificacion) + avisoUrgencia + avisoCorreo + pregunta,
    );
    s.pdfId = armado.pdfId;
    s.pdfUrl = armado.pdfUrl ?? undefined;
    s.pdfCaption = "📄 Tu acción de tutela, lista para imprimir y radicar.";
    return s;
  }

  // Falta info → preguntamos SOLO lo que falta (y si hubo duda, la respondemos antes)
  const nq = q(ml);
  const siguiente = await frasearSiguiente(null, body, nq.campo ?? "", nq.texto ?? "");
  sesion.pendingCampo = nq.campo ?? null;
  sesion.lastPregunta = siguiente;
  sesiones.set(from, sesion);
  return spec(duda ? `${duda}\n\n${siguiente}` : siguiente);
}

/** Base pública (proto://host) para armar URLs que Twilio pueda alcanzar. */
function baseUrlDe(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${req.headers.get("host") ?? ""}`;
}

/** Genera la URL del audio (Supabase, con respaldo local sobre baseUrl).
 *  voiceId = voz con el acento de la ciudad de la persona (o la default). */
async function audioUrlDe(mensaje: string, baseUrl: string, voiceId?: string): Promise<string | null> {
  // paraVoz: "09:00" se oye "cero nueve dos puntos cero cero" si no se traduce.
  const paraLeer = paraVoz(mensaje.replace(/https?:\/\/[^\s]+/g, "").trim());
  const buf = await sintetizarVoz(paraLeer, voiceId);
  if (!buf) return null;
  const url = await subirAudio(buf);
  if (url) return url;
  const id = guardarAudio(buf);
  return `${baseUrl}/api/audio/${id}.mp3`;
}

/**
 * Manda el texto como lo mandaría una persona: varias burbujas cortas, con la
 * pausa de tecleo entre una y otra y el "escribiendo…" prendido durante la
 * pausa (T25).
 */
async function enviarBurbujas(from: string, texto: string, sid: string): Promise<void> {
  const partes = partirMensaje(texto);
  if (!partes.length) return;
  for (let i = 0; i < partes.length; i++) {
    if (i > 0) {
      if (sid) void mostrarEscribiendo(sid);
      await dormir(pausaDeTecleo(partes[i]));
    }
    await enviarWhatsApp(from, { body: partes[i] });
  }
}

/** Entrega ASÍNCRONA: envía el mensaje (voz o texto) por la API de Twilio.
 *  Recibe baseUrl capturada al llegar el request (NO el req, que puede quedar
 *  inválido tras la demora del coalescing → rompería la URL del audio). */
async function entregarAsync(from: string, s: Spec, baseUrl: string, sid: string): Promise<void> {
  /* 📄 El PDF va PRIMERO, antes del audio y del texto: es el entregable, y que
   * llegue de primero es lo que hace que la persona entienda de una qué pasó.
   * Se espera su confirmación de entrega antes de seguir porque Twilio tarda en
   * descargar y entregar un adjunto, y si no, el audio y el texto —que son
   * instantáneos— le ganarían y llegarían a explicar un documento que todavía
   * no se ve. Es el mismo problema de orden que ya resolvía esperarMediaEntregado
   * para el flyer. */
  if (s.pdfId || s.pdfUrl) {
    const { sid: pdfSid } = await enviarWhatsAppDetalle(from, {
      mediaUrl: s.pdfUrl ?? `${baseUrl}/api/pdf/${s.pdfId}.pdf`,
      body: s.pdfCaption,
    });
    await esperarMediaEntregado(pdfSid);
  }

  // Lo que la persona pidió manda sobre el default del turno: si dijo "texto",
  // no recibe audios aunque el momento sea "de voz", y viceversa.
  const pref = sesiones.get(from)?.prefMedio ?? null;
  const quiereVoz = pref === "texto" ? false : pref === "audio" ? true : s.esVoz;
  const texto = humanizar(s.mensaje);

  if (quiereVoz && ttsDisponible()) {
    const audioUrl = await audioUrlDe(texto, baseUrl, voces.get(from));
    if (audioUrl) {
      const { ok: okAudio, sid: audioSid } = await enviarWhatsAppDetalle(from, { mediaUrl: audioUrl });
      // Si el audio no se pudo entregar (Twilio no alcanzó la URL), mandamos el
      // texto para NO dejar a la persona sin respuesta.
      if (!okAudio) await enviarBurbujas(from, texto, sid);
      if (s.textoExtra) {
        // El texto va DESPUÉS del audio: esperamos a que Twilio CONFIRME la
        // entrega del audio antes de soltarlo, para que no le gane el texto
        // (instantáneo) al audio (que Twilio tarda en descargar y entregar).
        if (sid) void mostrarEscribiendo(sid);
        await esperarMediaEntregado(audioSid);
        await enviarWhatsApp(from, { body: s.textoExtra });
      }
      return;
    }
  }
  await enviarBurbujas(from, texto, sid);
  if (s.textoExtra) {
    if (sid) void mostrarEscribiendo(sid);
    await dormir(pausaDeTecleo(s.textoExtra));
    await enviarWhatsApp(from, { body: s.textoExtra });
  }
}

/** Espera a que Twilio confirme la entrega del media (audio/imagen). Si no hay
 *  SID (envío sin Twilio o falló), cae a la pausa fija como respaldo. */
async function esperarMediaEntregado(mediaSid: string | null): Promise<void> {
  if (mediaSid) await esperarEntregaWhatsApp(mediaSid);
  else await dormir(PAUSA_TRAS_MEDIA_MS);
}

/** Entrega SÍNCRONA por TwiML (fallback local sin Twilio).
 *  TwiML admite varios <Message>, así que las burbujas cortas también aplican. */
async function entregarSync(from: string, s: Spec, req: Request): Promise<NextResponse> {
  const pref = sesiones.get(from)?.prefMedio ?? null;
  const quiereVoz = pref === "texto" ? false : pref === "audio" ? true : s.esVoz;
  const texto = humanizar(s.mensaje);

  const base = baseUrlDe(req);
  // El PDF de primero, igual que en la entrega asíncrona (aquí el orden lo
  // garantiza el orden de los <Message>, no hace falta esperar entregas).
  const pdfXml = (s.pdfId || s.pdfUrl)
    ? `<Message>${s.pdfCaption ? `<Body>${xmlEsc(s.pdfCaption)}</Body>` : ""}<Media>${xmlEsc(s.pdfUrl ?? `${base}/api/pdf/${s.pdfId}.pdf`)}</Media></Message>`
    : "";
  if (quiereVoz && ttsDisponible()) {
    const audioUrl = await audioUrlDe(texto, base, voces.get(from));
    if (audioUrl) {
      let xml = `<?xml version="1.0" encoding="UTF-8"?><Response>${pdfXml}<Message><Media>${xmlEsc(audioUrl)}</Media></Message>`;
      if (s.textoExtra) xml += `<Message>${xmlEsc(s.textoExtra)}</Message>`;
      return new NextResponse(xml + `</Response>`, { headers: { "Content-Type": "text/xml" } });
    }
  }
  const burbujas = partirMensaje(texto);
  const xml = pdfXml + burbujas.map((b) => `<Message>${xmlEsc(b)}</Message>`).join("")
    + (s.textoExtra ? `<Message>${xmlEsc(s.textoExtra)}</Message>` : "");
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${xml}</Response>`,
    { headers: { "Content-Type": "text/xml" } });
}

export async function POST(req: Request) {
  const form = await req.formData();

  // Esta ruta es pública por obligación (la llama Twilio). La firma es lo que
  // impide que un tercero forje mensajes y nos queme créditos de Gemini y voz.
  if (debeVerificarFirma()) {
    const params: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (typeof v === "string") params[k] = v;
    const firma = req.headers.get("x-twilio-signature") ?? "";
    if (!firmaValida(urlPublica(req), params, firma)) {
      console.warn(`[whatsapp] firma inválida — petición rechazada (url=${urlPublica(req)})`);
      return new NextResponse("firma inválida", { status: 403 });
    }
  }

  const from = String(form.get("From") ?? "");
  const body = String(form.get("Body") ?? "").trim();
  const sid = String(form.get("MessageSid") ?? "");
  const media = {
    num: parseInt(String(form.get("NumMedia") ?? "0"), 10),
    type: String(form.get("MediaContentType0") ?? ""),
    url: String(form.get("MediaUrl0") ?? ""),
  };

  if (sid && vistos.has(sid)) return twimlVacio(); // idempotencia
  if (sid) marcarVisto(sid);
  if (!from) return twimlVacio();

  // URL base pública capturada AL INSTANTE (el req puede quedar inválido tras la
  // demora del coalescing; la usamos para armar la URL del audio que Twilio busca).
  const baseUrl = baseUrlDe(req);

  // Con Twilio: responder al instante; la respuesta real se entrega async (evita timeout).
  if (twilioListo()) {
    // 🎙️ Nota de voz → se procesa de una (es un mensaje completo). Primero
    // cerramos cualquier ráfaga de texto pendiente para no responder fuera de orden.
    if (media.num > 0) {
      flushBuffer(from);
      encolarTurno(from, body, media, baseUrl, sid);
      return twimlVacio();
    }

    // 💬 Texto → acumula la ráfaga y espera DEBOUNCE_MS a que termine de escribir.
    // Si manda 3 mensajes seguidos, se leen TODOS juntos y se responde UNA vez.
    const b = buffers.get(from) ?? { partes: [], timer: null, baseUrl, sid };
    if (body) b.partes.push(body);
    b.baseUrl = baseUrl;
    b.sid = sid; // el indicador de "escribiendo" cuelga del último SID entrante
    if (b.timer) clearTimeout(b.timer);
    b.timer = setTimeout(() => flushBuffer(from), DEBOUNCE_MS);
    buffers.set(from, b);
    return twimlVacio();
  }

  // Sin Twilio (pruebas locales/curl): entrega síncrona por TwiML (sin debounce).
  const s = await encolar(from, () => computarRespuesta(from, body, media));
  return entregarSync(from, s, req);
}

/**
 * Mijo por teléfono, CONVERSANDO — el canal para quien no tiene WhatsApp.
 *
 * Sucesor del asesor de voz del proyecto anterior: se conservó su máquina de
 * turnos (que estaba bien resuelta) y se le cambió el cerebro entero.
 *
 * POR QUÉ ESTE CANAL. Todo el producto entrega por WhatsApp, y eso excluye
 * justo al usuario que más lo necesita: la persona mayor con un teléfono
 * básico, sin datos, que lleva ocho meses peleando con la EPS. Pedirle WhatsApp
 * es pedirle exactamente lo que no tiene. Aquí solo tiene que contestar el
 * teléfono y hablar.
 *
 * QUÉ CAMBIA RESPECTO DEL CHAT. Por teléfono no se puede releer ni corregir,
 * así que:
 *   · Una pregunta por turno, corta. Nada de "dime tu nombre y tu cédula".
 *   · El correo se CONFIRMA leyéndolo de vuelta: es el dato que el
 *     reconocimiento de voz destroza y el único sin el cual no hay entrega.
 *   · Si algo se cae, se cuelga hablando, nunca en silencio.
 *
 * LA ENTREGA. Al final el PDF va por CORREO, no por WhatsApp: quien llamó por
 * teléfono probablemente no lo tiene. Si no logra dar un correo, igual se le
 * lee qué hacer y el documento queda guardado.
 */
import { armarTutela } from "@/lib/armarTutela";
import { extraerCampos } from "@/lib/conversacion";
import { correoDisponible, enviarTutelaAlUsuario, resolverReparto } from "@/lib/correo";
import { perfilarLead } from "@/lib/flow";
import { obtenerPdf } from "@/lib/pdfStore";
import { createLead, getLead } from "@/lib/store";
import { subirAudio } from "@/lib/storage";
import { sintetizarVoz, ttsDisponible, voiceIdPorCiudad } from "@/lib/tts";
import { limpiarParaVoz, type ModoEscucha } from "@/lib/voz/twiml";

interface SesionVoz {
  casoId: string;
  telefono: string;
  pendiente: string | null;
  relato: string[];
  /** Correo dictado, a la espera de que lo confirme. */
  correoTentativo: string | null;
  turnos: number;
  ciudad: string | null;
}

const g = globalThis as unknown as { __vozMijo?: Map<string, SesionVoz> };
const sesiones: Map<string, SesionVoz> = g.__vozMijo ?? (g.__vozMijo = new Map());

export function getSesion(callSid: string): SesionVoz | undefined {
  return sesiones.get(callSid);
}
export function borrarSesion(callSid: string): void {
  sesiones.delete(callSid);
}

/* Tope de turnos: una llamada que no avanza en 25 idas y vueltas no va a
 * avanzar, y dejarla abierta le gasta minutos a la persona. */
const MAX_TURNOS = 25;

export interface RespuestaVoz {
  texto: string;
  audioUrl: string | null;
  colgar?: boolean;
  /** Cómo escuchar la respuesta a ESTA pregunta (ver lib/voz/twiml.ts). */
  modo?: ModoEscucha;
}

/* Qué modo pide cada campo. Salió de una llamada real: la cédula dictada se
 * entiende mal y el correo deletreado se corta a la primera pausa. */
const MODO_CAMPO: Record<string, ModoEscucha> = {
  cedula: "numeros",
  correo: "deletreo",
};

/* Caché de audios ya sintetizados.
 *
 * Twilio corta la llamada si el webhook no responde en ~15 s, y de esos, entre
 * 2 y 4 se iban en sintetizar y subir el MP3. Pero las preguntas son SIEMPRE
 * las mismas ocho frases: sintetizarlas de nuevo en cada llamada es pagar el
 * mismo peaje una y otra vez con el reloj de Twilio corriendo. Con la caché,
 * a partir de la segunda llamada esos segundos desaparecen.
 *
 * La clave incluye la voz porque el acento cambia con la ciudad. */
const g2 = globalThis as unknown as { __vozCache?: Map<string, string> };
const cacheAudio: Map<string, string> = g2.__vozCache ?? (g2.__vozCache = new Map());

/** Sintetiza con la voz de siempre. Si falla, el TwiML cae a la voz de Twilio. */
async function vocalizar(
  texto: string, ciudad: string | null, modo: ModoEscucha = "voz",
): Promise<RespuestaVoz> {
  const limpio = limpiarParaVoz(texto);
  if (!ttsDisponible()) return { texto: limpio, audioUrl: null, modo };

  const voz = voiceIdPorCiudad(ciudad);
  const clave = `${voz}|${limpio}`;
  const guardado = cacheAudio.get(clave);
  if (guardado) return { texto: limpio, audioUrl: guardado, modo };

  const buf = await sintetizarVoz(limpio, voz);
  const url = buf ? await subirAudio(buf) : null;
  /* Solo se cachean las frases fijas (las preguntas). Las que llevan datos de
   * la persona no se repiten nunca y llenarían el mapa sin servir de nada. */
  if (url && limpio.length < 220) {
    cacheAudio.set(clave, url);
    if (cacheAudio.size > 200) cacheAudio.delete(cacheAudio.keys().next().value!);
  }
  return { texto: limpio, audioUrl: url, modo };
}

/**
 * Le pone reloj a una promesa.
 *
 * Gemini normalmente contesta en 2-4 s, pero un día malo se va a 12 y ahí la
 * llamada muere. Antes que una extracción perfecta que llega tarde, sirve más
 * una por reglas que llega a tiempo: la persona sigue hablando en vez de
 * escuchar el silencio de una llamada que Twilio ya cortó.
 */
function conReloj<T>(p: Promise<T>, ms: number, siTarda: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((r) => setTimeout(() => {
      console.warn(`[voz] se pasó de ${ms}ms, se sigue sin esperar`);
      r(siTarda);
    }, ms)),
  ]);
}

/* Las preguntas, dictadas para el oído: una sola cosa, sin paréntesis ni
 * ejemplos entre comas, que al escucharlos se confunden con la respuesta. */
const PREGUNTA_VOZ: Record<string, string> = {
  que_negaron: "Cuénteme, ¿qué fue lo que le negó su EPS?",
  accionado: "¿Y cuál es su EPS?",
  fecha_negacion: "¿Hace cuánto fue eso? Con que me diga más o menos, basta.",
  ya_reclamo: "¿Usted ya reclamó en la EPS?",
  ciudad: "¿En qué ciudad vive?",
  nombre: "¿Cuál es su nombre completo?",
  cedula: "¿Me regala su número de cédula? Puede marcarla en el teclado del teléfono y al terminar oprima la tecla numeral.",
  correo: "Por último, ¿tiene correo electrónico? Deletréemelo con calma, letra por letra. Yo espero. Cuando termine, oprima la tecla numeral.",
};

/** Arranca la llamada: crea el caso y saluda con la primera pregunta. */
export async function iniciarLlamada(callSid: string, telefono: string): Promise<RespuestaVoz> {
  const lead = await createLead({
    canal: "voz", nombre: null, telefono, email: null, cedula: null, consentimiento: true,
  });
  const ml = await perfilarLead(lead.id, {});
  const campo = (ml?.next_question as { campo?: string })?.campo ?? "que_negaron";

  sesiones.set(callSid, {
    casoId: lead.id, telefono, pendiente: campo, relato: [],
    correoTentativo: null, turnos: 0, ciudad: null,
  });

  return vocalizar(
    "Hola, le habla Mijo. Yo le ayudo a poner una tutela si su EPS le negó algo. "
    + "No necesita abogado y no le cuesta nada. "
    + (PREGUNTA_VOZ[campo] ?? PREGUNTA_VOZ.que_negaron),
    null, MODO_CAMPO[campo] ?? "voz",
  );
}

/* "primero de junio" no lo entiende ningún extractor de fechas: espera un
 * número. Y por teléfono la gente dice el día así — es como se dice en
 * castellano. Se traduce antes de que el texto llegue al modelo. */
const ORDINALES: Record<string, string> = {
  primero: "1", primer: "1", segundo: "2", tercero: "3", tercer: "3", cuarto: "4",
  quinto: "5", sexto: "6", septimo: "7", "séptimo": "7", octavo: "8", noveno: "9",
  decimo: "10", "décimo": "10", undecimo: "11", "undécimo": "11",
  duodecimo: "12", "duodécimo": "12",
};

export function normalizarOrdinales(texto: string): string {
  return texto.replace(
    /\b(primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|sext[oa]|s[eé]ptim[oa]|octav[oa]|noven[oa]|d[eé]cim[oa]|und[eé]cim[oa]|duod[eé]cim[oa])\b/gi,
    (m) => {
      const k = m.toLowerCase().replace(/[ao]$/, "");
      return ORDINALES[k] ?? ORDINALES[m.toLowerCase()] ?? m;
    },
  );
}

/**
 * Lee un correo dictado.
 *
 * El reconocimiento de voz devuelve "juan punto perez arroba gmail punto com" o
 * "juanperez@gmail.com" según el día. Se normalizan las dos formas. Esto es
 * exactamente lo que hay que resolver en código y no pedirle a un modelo: es
 * una transliteración fija, y equivocarse manda el documento a la nada.
 */
export function correoDeVoz(dicho: string): string | null {
  let t = dicho.toLowerCase().trim();
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(t)) {
    return t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)![0];
  }
  t = t
    .replace(/\s*(arroba|at)\s*/g, "@")
    .replace(/\s*(punto|dot)\s*/g, ".")
    .replace(/\s*(guion bajo|guión bajo)\s*/g, "_")
    .replace(/\s*(guion|guión)\s*/g, "-")
    .replace(/\s+/g, "");
  const m = t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0] : null;
}

/** Deletrea el correo para confirmarlo: "j, u, a, n, arroba, gmail punto com". */
function deletrear(correo: string): string {
  const [local, dominio] = correo.split("@");
  return `${local.split("").join(", ")}, arroba, ${dominio.replace(/\./g, " punto ")}`;
}

/* Sí y no, dichos como los dice la gente por teléfono.
 *
 * OJO con \b y las tildes: en "sí" el límite final tendría que caer después de
 * "í", que en regex ASCII no es carácter de palabra, así que \bsí\b NO matchea
 * nunca — y Twilio transcribe CON tilde. Por eso se normaliza primero y recién
 * después se compara. Esta trampa ya estaba documentada en lib/mensajes.ts del
 * proyecto anterior y la volví a pisar.
 */
function normalizar(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

export function esAfirmativo(t: string): boolean {
  const n = normalizar(t);
  if (/\bno\b/.test(n)) return false;   // "no, esta mal" gana sobre "esta"
  return /(^|\s)(si|sii|claro|correcto|exacto|exactamente|asi es|esta bien|estabien|listo|dale|perfecto|de una|afirmativo|ok|okey|obvio|ya)(\s|$|,|\.)/.test(n);
}

export function esNegativo(t: string): boolean {
  const n = normalizar(t);
  return /(^|\s)(no|nop|negativo|esta mal|mal|equivocado|incorrecto|otra vez|repita|repitame)(\s|$|,|\.)/.test(n);
}

/** Un turno: la persona habló, respondemos. */
export async function turnoDeVoz(callSid: string, dicho: string): Promise<RespuestaVoz> {
  const s = sesiones.get(callSid);
  if (!s) return { ...(await vocalizar("Se me perdió la llamada. Vuelva a marcar, por favor.", null)), colgar: true };

  s.turnos++;
  if (s.turnos > MAX_TURNOS) {
    return { ...(await vocalizar("Mejor le escribo por WhatsApp para terminar. Que esté muy bien.", s.ciudad)), colgar: true };
  }
  if (!dicho) {
    const p = s.pendiente ?? "que_negaron";
    return vocalizar(`No le escuché. ${PREGUNTA_VOZ[p] ?? ""}`, s.ciudad, MODO_CAMPO[p] ?? "voz");
  }

  /* Confirmación del correo: es el único dato que se lee de vuelta, porque es el
   * único que si sale mal deja a la persona sin documento. */
  if (s.correoTentativo) {
    if (esAfirmativo(dicho)) {
      const correo = s.correoTentativo;
      s.correoTentativo = null;
      return cerrar(callSid, s, correo);
    }
    if (esNegativo(dicho)) {
      s.correoTentativo = null;
      return vocalizar(
        "Está bien, deletréemelo otra vez. Cuando termine, oprima la tecla numeral.",
        s.ciudad, "deletreo",
      );
    }
    /* Ni sí ni no: se repite LA CONFIRMACIÓN, no la pregunta entera. Volver a
     * pedir el correo cuando lo que falló fue entender un "sí" mandaba a la
     * persona a deletrear otra vez en un bucle sin salida. */
    return vocalizar(
      `Perdone, ¿el correo quedó bien? Dígame sí o no. Le repito: ${deletrear(s.correoTentativo)}.`,
      s.ciudad, "voz",
    );
  }

  const dichoNorm = normalizarOrdinales(dicho);
  s.relato.push(dichoNorm);

  /* El correo se extrae con su propio lector, no con el del chat: por teléfono
   * llega dictado ("punto", "arroba") y el extractor de texto no lo entiende. */
  const campos: Record<string, unknown> = {};
  if (s.pendiente === "correo") {
    const c = correoDeVoz(dicho);
    if (c) {
      s.correoTentativo = c;
      return vocalizar(`Le repito para confirmar: ${deletrear(c)}. ¿Está bien?`, s.ciudad, "voz");
    }
    if (/\b(no tengo|no manejo|ninguno|no uso)\b/i.test(dicho)) {
      return cerrar(callSid, s, null);
    }
    return vocalizar(
      "Perdón, no lo alcancé a captar. Deletréemelo otra vez, con calma. "
      + "Yo no lo interrumpo: cuando termine, oprima la tecla numeral.",
      s.ciudad, "deletreo",
    );
  }

  /* 9 segundos de tope. Empezó en 6 y cortaba demasiado —nueve veces en una sola
   * llamada—, dejando la extracción en reglas casi siempre. Con las preguntas ya
   * cacheadas el TTS tarda milisegundos, así que 9 sigue dejando margen frente a
   * los 15 de Twilio y recupera la extracción buena en la mayoría de los turnos. */
  const ext = await conReloj(
    extraerCampos(dichoNorm, s.pendiente ?? ""),
    9000,
    { campos: { [s.pendiente ?? "que_negaron"]: dichoNorm }, duda: null },
  );
  Object.assign(campos, ext.campos);
  if (typeof campos.ciudad === "string") s.ciudad = campos.ciudad;

  const ml = await perfilarLead(s.casoId, { ...campos, relato: s.relato.join("\n") });
  if (!ml) return vocalizar("Se me enredó algo. ¿Me lo repite?", s.ciudad);

  if (ml.status === "qualified") return cerrar(callSid, s, null);

  const campo = (ml.next_question as { campo?: string })?.campo ?? "que_negaron";
  s.pendiente = campo;
  const acuse = ext.duda ? `${ext.duda} ` : "";
  return vocalizar(
    `${acuse}${PREGUNTA_VOZ[campo] ?? "Cuénteme un poco más."}`, s.ciudad, MODO_CAMPO[campo] ?? "voz",
  );
}

/**
 * Cierra la llamada — SIN esperar a que la tutela esté armada.
 *
 * Twilio corta la llamada si el webhook no responde en ~15 segundos, y armar la
 * tutela toma entre 40 y 60 (tres llamadas a Gemini, embeddings, verificación y
 * Chromium). Esperarla aquí dentro hacía que la llamada muriera SIEMPRE justo
 * al final, después de que la persona ya había contado todo. El peor momento
 * posible para colgarle a alguien.
 *
 * Así que se responde primero y se trabaja después, igual que el webhook de
 * WhatsApp con entregarAsync(): se despide, cuelga, y el documento se arma en
 * segundo plano y sale por correo. Si dejó correo, ahí le llega; si no, queda
 * guardado a su nombre.
 */
async function cerrar(callSid: string, s: SesionVoz, correo: string | null): Promise<RespuestaVoz> {
  const lead = await getLead(s.casoId);
  const respuestas = (lead?.respuestas ?? {}) as Record<string, unknown>;
  if (correo) respuestas.correo = correo;
  const destino = correo || String(respuestas.correo ?? "");
  const eps = String(respuestas.accionado ?? "") || "su EPS";
  const ciudad = String(respuestas.ciudad ?? "") || "su ciudad";

  borrarSesion(callSid);

  /* Se dispara y NO se espera. El `void` es deliberado: si esto se awaitea, la
   * llamada muere. Los errores se registran, no se propagan. */
  void armarYEnviar(s, respuestas, destino).catch((e) =>
    console.error("[voz] armado en segundo plano falló:", e),
  );

  const partes = [
    `Listo. Ya tengo todo lo que necesito para su tutela contra ${eps}.`,
    destino.includes("@")
      ? "En unos minutos le llega al correo, con el documento y las instrucciones."
      : "La voy a dejar guardada a su nombre.",
    "Mientras tanto, escúcheme lo que tiene que hacer cuando le llegue.",
    "Imprima dos copias y fírmelas a mano.",
    `Llévelas a cualquier juzgado de ${ciudad} y pregunte por la oficina de reparto.`,
    "Entrega una y le devuelven la otra sellada. Esa guárdela, es su comprobante.",
    "No necesita abogado y no le cuesta nada.",
    "El juez tiene diez días para responderle.",
    "Que le vaya muy bien.",
  ];

  return { ...(await vocalizar(partes.join(" "), s.ciudad)), colgar: true };
}

/** El trabajo pesado, ya con la llamada cerrada. */
async function armarYEnviar(
  s: SesionVoz, respuestas: Record<string, unknown>, destino: string,
): Promise<void> {
  const armado = await armarTutela(s.relato.join("\n"), respuestas, s.telefono);
  if (armado.estado !== "listo") {
    console.error("[voz] no se pudo armar la tutela:", armado.motivo);
    return;
  }
  if (!destino.includes("@") || !correoDisponible()) return;

  const pdf = obtenerPdf(armado.pdfId);
  if (!pdf) return;

  const r = await enviarTutelaAlUsuario({
    para: destino, nombre: armado.doc.accionante.nombre, pdf,
    nombreArchivo: "accion-de-tutela.pdf",
    kit: {
      doc: armado.doc, correoUsuario: destino, telefono: s.telefono,
      reparto: resolverReparto(armado.doc.accionante.ciudad),
    },
  }).catch(() => null);
  console.log(`[voz] tutela por correo a ${destino}: ${r?.ok ? "enviada" : "falló"}`);
}

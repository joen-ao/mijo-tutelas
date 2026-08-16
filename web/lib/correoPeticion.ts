/**
 * Envío del derecho de petición por correo: a la ENTIDAD (la EPS) y la copia a
 * la persona.
 *
 * Vive aparte de lib/correo.ts a propósito. Ese archivo radica ante una oficina
 * JUDICIAL; este radica ante una EMPRESA, y las dos cosas se parecen solo por
 * fuera. Radicar por correo es una vía válida: el art. 15 de la Ley 1755 de 2015
 * admite presentar la petición «a través de cualquier medio idóneo para la
 * comunicación o transferencia de datos», y el parágrafo 3 del art. 32 prohíbe a
 * las entidades privadas negarse a recibirla y radicarla.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE NO SE NEGOCIA (la misma de lib/correo.ts, por otra razón)
 *
 * En desarrollo y en la demo NUNCA sale un correo a una EPS real. Allá el daño
 * era ocuparle un turno a un juez; aquí es distinto y peor de lo que parece: una
 * petición de prueba radicada a nombre de una persona que no existe ensucia el
 * buzón donde se atienden peticiones de gente enferma, y una radicada a nombre
 * de alguien real le abre un trámite que no pidió.
 *
 * Hay DOS frenos, no uno:
 *   1. El override redirige el envío. ENTIDAD_OVERRIDE_EMAIL, y si no está,
 *      REPARTO_OVERRIDE_EMAIL — así el entorno de demo que ya existe queda
 *      protegido sin tocar .env.local, que es justo el descuido que se paga.
 *   2. Sin override, se REHÚSA enviar a una dirección marcada verificado=false
 *      en data/eps-correos.json. Que la persona crea que radicó cuando el correo
 *      se fue a un buzón equivocado es el peor final posible: el término del
 *      art. 14 nunca empieza a correr y ella lo está contando.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Degradación igual que en lib/correo.ts: sin API key devuelve un fallo
 * explicado y nunca lanza. El correo es un extra sobre el PDF que la persona YA
 * recibió por WhatsApp; que falle no puede costarle la petición, porque puede
 * imprimirla y llevarla a la ventanilla, que además le deja el sello en la mano.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  articuloDelTermino,
  fechaLargaUtc,
  nombreDelTipo,
  vencimiento,
  type Peticion,
} from "@/lib/peticion";

const API_KEY = (process.env.RESEND_API_KEY ?? "").trim();

/* Mismo despojado de comillas que en lib/correo.ts: Next las quita al parsear
 * .env, pero un script que lea el archivo a mano no, y Resend rechaza con 422
 * un `from` entrecomillado. */
function sinComillas(v: string | undefined, porDefecto: string): string {
  const t = (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
  return t || porDefecto;
}

const FROM = sinComillas(process.env.CORREO_FROM, "Mijo <onboarding@resend.dev>");

export function correoPeticionDisponible(): boolean {
  return Boolean(API_KEY);
}

function lista(v: string | undefined): string[] {
  return (v ?? "").replace(/^["']|["']$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
}

/* Se hereda REPARTO_OVERRIDE_EMAIL cuando no hay uno propio: el .env de la demo
 * ya lo tiene puesto, y un archivo nuevo que estrena su propia variable llega
 * al mundo con el freno suelto hasta que alguien se acuerde de configurarla. */
const OVERRIDE_ENTIDAD = lista(process.env.ENTIDAD_OVERRIDE_EMAIL).length
  ? lista(process.env.ENTIDAD_OVERRIDE_EMAIL)
  : lista(process.env.REPARTO_OVERRIDE_EMAIL);

const OVERRIDE_USUARIO = lista(process.env.USUARIO_OVERRIDE_EMAIL);

/* ── El mapa de EPS ──────────────────────────────────────────────────────── */

export interface CorreoEps {
  nombre: string;
  correo: string | null;
  verificado: boolean;
}

let mapa: Record<string, CorreoEps> | null = null;

function cargarMapa(): Record<string, CorreoEps> {
  if (mapa) return mapa;
  try {
    const bruto = JSON.parse(
      readFileSync(join(process.cwd(), "data", "eps-correos.json"), "utf-8"),
    ) as Record<string, unknown>;
    const out: Record<string, CorreoEps> = {};
    for (const [k, v] of Object.entries(bruto)) {
      if (k.startsWith("_")) continue; // metadatos de la fuente
      out[k] = v as CorreoEps;
    }
    mapa = out;
  } catch (e) {
    console.error("[correo-peticion] no se pudo leer data/eps-correos.json:", e instanceof Error ? e.message : e);
    mapa = {};
  }
  return mapa;
}

/** "NUEVA EPS S.A." → "nueva eps". Sin tildes, sin sufijos societarios. */
function claveEps(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(s\.?a\.?s\.?|s\.?a\.?|e\.?p\.?s\.?-?s\.?|ltda\.?)\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Busca el buzón de una EPS. null si no la tenemos — y entonces la persona
 * radica en la oficina de atención al usuario, que además le deja el sello de
 * recibido, que es mejor prueba que un correo enviado.
 *
 * La coincidencia es por prefijo en los dos sentidos porque el nombre llega como
 * lo escribió la persona ("nueva eps", "la Nueva EPS", "Nueva EPS S.A."), no
 * como está en el mapa.
 */
export function resolverCorreoEps(nombre: string): CorreoEps | null {
  if (!nombre?.trim()) return null;
  const k = claveEps(nombre);
  if (!k) return null;
  const m = cargarMapa();
  if (m[k]) return m[k];
  for (const [clave, v] of Object.entries(m)) {
    if (k.includes(clave) || clave.includes(k)) return v;
  }
  return null;
}

/* ── El envío ────────────────────────────────────────────────────────────── */

interface Adjunto { filename: string; content: Buffer }

interface Envio {
  to: string[];
  subject: string;
  html: string;
  attachments?: Adjunto[];
}

/**
 * Manda el correo. Un reintento ante 429 (cuota) o 5xx (Resend caído), que son
 * los dos fallos transitorios; un 4xx distinto es culpa nuestra y reintentarlo
 * solo gasta tiempo. Copiado de lib/correo.ts, que no se puede importar porque
 * `enviar` no está exportada allá.
 */
async function enviar(e: Envio): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!API_KEY) return { ok: false, error: "falta RESEND_API_KEY" };

  const { Resend } = await import("resend");
  const resend = new Resend(API_KEY);

  for (let intento = 0; intento < 2; intento++) {
    try {
      const { data, error } = await resend.emails.send({
        from: FROM,
        to: e.to,
        subject: e.subject,
        html: e.html,
        attachments: e.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content.toString("base64"),
        })),
      });

      if (!error) return { ok: true, id: data?.id };

      const msg = error.message ?? String(error);
      const transitorio = /rate.?limit|429|5\d\d|timeout|ECONN/i.test(msg);
      if (transitorio && intento === 0) {
        console.warn(`[correo-peticion] fallo transitorio (${msg}), reintentando…`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      console.error("[correo-peticion] Resend rechazó el envío:", msg);
      return { ok: false, error: msg };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (intento === 0) {
        console.warn(`[correo-peticion] error de red (${msg}), reintentando…`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      console.error("[correo-peticion]", msg);
      return { ok: false, error: msg };
    }
  }
  return { ok: false, error: "agotados los reintentos" };
}

const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ── 1. La petición, a la ENTIDAD ────────────────────────────────────────── */

export interface ResultadoRadicacionPeticion {
  ok: boolean;
  id?: string;
  /** A quién habría ido en producción. SIEMPRE se calcula, aunque haya override. */
  destinatarioReal: string | null;
  /** A quién se envió de verdad. */
  destinatarioUsado: string[];
  entidad?: string;
  /** Días hábiles que quedaron corriendo, para decírselo a la persona. */
  plazoDias?: number;
  /** ISO del día en que se vence el término, calculado por el código. */
  venceIso?: string;
  error?: string;
}

/**
 * Radica el derecho de petición ante la EPS.
 *
 * `doc` se usa para el cuerpo del correo, no solo para el asunto: el mensaje
 * repite el término y su artículo, porque el PDF adjunto lo puede no abrir nadie
 * y el cuerpo del correo sí se lee.
 */
export async function radicarPeticionAnteEntidad(params: {
  doc: Peticion;
  pdf: Buffer;
  nombreArchivo: string;
}): Promise<ResultadoRadicacionPeticion> {
  const { doc } = params;
  const entidad = doc.destinatario.nombre || "la entidad";
  const eps = doc.destinatario.correo
    ? { nombre: entidad, correo: doc.destinatario.correo, verificado: false }
    : resolverCorreoEps(entidad);

  if (!eps?.correo) {
    return {
      ok: false,
      destinatarioReal: null,
      destinatarioUsado: [],
      error: `no tenemos el buzón de "${entidad}"; la persona debe radicarla en la oficina de atención al usuario`,
    };
  }

  const real = eps.correo;
  const hayOverride = OVERRIDE_ENTIDAD.length > 0;
  const usado = hayOverride ? OVERRIDE_ENTIDAD : [real];

  // SIEMPRE se loguean los dos. Es la línea que deja claro qué habría pasado en
  // producción y qué pasó de verdad.
  console.log(
    `[peticion-entidad] real=${real} usado=${usado.join(",")} override=${hayOverride ? "sí" : "no"}`,
  );

  /* El segundo freno. Sin override estamos en producción, y ahí una dirección
   * sin confirmar no se usa: se le devuelve el control a la persona, que puede
   * radicar en ventanilla y salir con el sello. */
  if (!hayOverride && !eps.verificado) {
    console.error(
      `[peticion-entidad] ⚠️ ${entidad}: el correo ${real} NO está confirmado contra el sitio `
      + "oficial de la EPS. Se cancela el envío. Verificar y marcar verificado=true en data/eps-correos.json.",
    );
    return {
      ok: false,
      destinatarioReal: real,
      destinatarioUsado: [],
      entidad,
      error: `el correo de "${entidad}" no está verificado; no se radica a ciegas`,
    };
  }

  const plazo = vencimiento(doc);

  const avisoPrueba = hayOverride
    ? `<div style="background:#ffe1e1;border:2px solid #c0392b;padding:14px 18px;margin:0 0 24px;
         font-family:-apple-system,sans-serif;font-size:15px;color:#7d2018">
         <b>⚠️ ENVÍO DE PRUEBA — NO ES UNA RADICACIÓN REAL</b><br>
         Destinatario real en producción: <b>${esc(real)}</b> (${esc(entidad)}).<br>
         Este mensaje se redirigió a un buzón de pruebas y <b>no llegó a la EPS</b>.
       </div>`
    : "";

  const advertenciaVerificado = eps.verificado
    ? ""
    : `<p style="font-size:13px;color:#8b6b20;margin:0 0 16px">
         Nota interna: la dirección de esta EPS no está confirmada contra su sitio oficial.
         Verificar antes de radicar en producción.
       </p>`;

  const r = await enviar({
    to: usado,
    subject: `DERECHO DE PETICIÓN — ${doc.peticionario.nombre} C.C. ${doc.peticionario.cedula} — ${doc.objeto}`,
    html: `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1c1e;max-width:640px">
  ${avisoPrueba}
  <p style="margin:0 0 16px">Señores<br><b>${esc(entidad)}</b><br>Oficina de Atención al Usuario</p>

  <p style="margin:0 0 16px">
    Respetuosamente radico <b>DERECHO DE PETICIÓN</b>, con fundamento en el artículo 23 de la
    Constitución Política y en la Ley 1755 de 2015, en los siguientes términos:
  </p>

  <table style="border-collapse:collapse;margin:0 0 16px">
    <tr><td style="padding:4px 12px 4px 0;color:#555">Peticionario</td>
        <td style="padding:4px 0"><b>${esc(doc.peticionario.nombre)}</b></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#555">Identificación</td>
        <td style="padding:4px 0">C.C. ${esc(doc.peticionario.cedula)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#555">Modalidad</td>
        <td style="padding:4px 0">${esc(nombreDelTipo(doc.tipo))}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#555">Asunto</td>
        <td style="padding:4px 0">${esc(doc.objeto)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#555">Ciudad</td>
        <td style="padding:4px 0">${esc(doc.peticionario.ciudad)}</td></tr>
  </table>

  ${advertenciaVerificado}

  <p style="margin:0 0 16px">
    <b>El escrito va adjunto en PDF.</b> Conforme al ${esc(articuloDelTermino(doc.tipo))},
    esta petición debe resolverse dentro de los <b>${plazo.dias} días hábiles siguientes a su
    recepción</b>. Se solicita acusar recibo de esta comunicación y remitir el número de
    radicado a la dirección de notificaciones indicada en el escrito.
  </p>

  <p style="margin:0 0 16px">
    La petición se presenta en nombre propio y sin apoderado, conforme al artículo 13 de la
    Ley 1755 de 2015, y se remite por medio electrónico conforme al artículo 15 de la misma ley.
  </p>

  <p style="margin:0;color:#555;font-size:13px">
    Documento preparado con asistencia de Mijo a partir del relato del peticionario. Los
    términos citados corresponden al artículo 14 de la Ley 1755 de 2015.
  </p>
</div>`.trim(),
    attachments: [{ filename: params.nombreArchivo, content: params.pdf }],
  });

  return {
    ok: r.ok,
    id: r.id,
    error: r.error,
    destinatarioReal: real,
    destinatarioUsado: usado,
    entidad,
    plazoDias: plazo.dias,
    venceIso: plazo.fecha.toISOString(),
  };
}

/* ── 2. La copia, a la persona ───────────────────────────────────────────── */

/** Los datos de una radicación ya hecha, para acompañar la copia como constancia. */
export interface ConstanciaPeticion {
  entidad: string;
  /** A quién se radicó DE VERDAD en producción. */
  destinatarioReal: string;
  /** Adónde salió el correo en esta corrida (puede ser el buzón de pruebas). */
  destinatarioUsado: string[];
  idEnvio?: string;
  esPrueba: boolean;
}

/**
 * Le manda a la persona su copia. El PDF adjunto es el MISMO archivo que recibió
 * la EPS: si fuera otro deja de ser una constancia.
 *
 * El correo lleva SIEMPRE la fecha de vencimiento calculada, porque es el dato
 * que la persona tiene que recordar dentro de tres semanas, cuando ya no tenga
 * la conversación de WhatsApp a la mano.
 */
export async function enviarPeticionAlUsuario(params: {
  para: string;
  doc: Peticion;
  pdf: Buffer;
  nombreArchivo: string;
  /** Si viene, el correo es la COPIA DE LO RADICADO, no "tu petición está lista". */
  constancia?: ConstanciaPeticion;
}): Promise<{ ok: boolean; id?: string; error?: string; destinatarioUsado: string[] }> {
  const { doc } = params;
  const real = [params.para];
  const usado = OVERRIDE_USUARIO.length ? OVERRIDE_USUARIO : real;
  if (OVERRIDE_USUARIO.length) {
    console.log(`[peticion-usuario] real=${params.para} usado=${usado.join(",")} override=sí`);
  }

  const plazo = vencimiento(doc);
  const entidad = doc.destinatario.nombre || "tu EPS";
  const c = params.constancia;

  const aviso = OVERRIDE_USUARIO.length
    ? `<div style="background:#fff4d6;border:1px solid #e0b84c;padding:12px 16px;margin:0 0 20px;
         font-family:-apple-system,sans-serif;font-size:14px">
         <b>⚠️ ENVÍO DE PRUEBA</b><br>Destinatario real: <b>${esc(params.para)}</b>.
         Redirigido por <code>USUARIO_OVERRIDE_EMAIL</code>.
       </div>`
    : "";

  const constanciaHtml = c
    ? `<div style="border:1px solid #cdd5cd;padding:16px 18px;margin:0 0 24px;
         font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6">
         <div style="font-size:17px;font-weight:700;margin-bottom:10px">
           ${c.esPrueba ? "Constancia de envío (PRUEBA)" : "Constancia de radicación"}
         </div>
         <table style="border-collapse:collapse">
           <tr><td style="padding:3px 12px 3px 0;color:#555">Radicada ante</td>
               <td style="padding:3px 0"><b>${esc(c.entidad)}</b></td></tr>
           <tr><td style="padding:3px 12px 3px 0;color:#555">Correo de la EPS</td>
               <td style="padding:3px 0">${esc(c.destinatarioReal)}</td></tr>
           ${c.esPrueba
             ? `<tr><td style="padding:3px 12px 3px 0;color:#8b6b20">Enviado realmente a</td>
                    <td style="padding:3px 0;color:#8b6b20">${esc(c.destinatarioUsado.join(", "))}</td></tr>`
             : ""}
           ${c.idEnvio
             ? `<tr><td style="padding:3px 12px 3px 0;color:#555">Comprobante</td>
                    <td style="padding:3px 0;font-family:monospace;font-size:13px">${esc(c.idEnvio)}</td></tr>`
             : ""}
         </table>
         <p style="margin:12px 0 0">
           <b>El PDF adjunto es exactamente el documento que recibió la EPS.</b>
           Guárdalo: es tu respaldo de lo que se radicó.
         </p>
         ${c.esPrueba
           ? `<p style="margin:10px 0 0;color:#8b6b20;font-size:13.5px">
                ⚠️ Envío de PRUEBA: no llegó a la EPS. En producción habría ido a
                ${esc(c.destinatarioReal)}.</p>`
           : ""}
       </div>`
    : "";

  /* La fecha va en grande y sola. Es lo único de este correo que la persona va a
   * necesitar buscar después, y si no responden para entonces, es el día en que
   * la tutela pasa a estar servida. */
  const bloquePlazo = `
    <div style="border:1px solid #cdd5cd;padding:16px 18px;margin:0 0 20px;
         font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6">
      <div style="font-size:17px;font-weight:700;margin-bottom:8px">
        ${esc(entidad)} tiene ${plazo.dias} días hábiles para responderte
      </div>
      <p style="margin:0 0 10px">
        Contados desde que reciben la petición (${esc(articuloDelTermino(doc.tipo))}).
        Hábiles significa que no cuentan sábados, domingos ni festivos.
      </p>
      <p style="margin:0 0 10px">
        Si la recibieron ${c ? "hoy" : "el día que la radiques"}, el término se vence
        alrededor del <b>${esc(fechaLargaUtc(plazo.fecha))}</b>.
      </p>
      <p style="margin:0">
        <b>Si ese día no te han respondido —o te responden con evasivas— escríbeme otra vez
        por WhatsApp.</b> Ahí ya procede la tutela, y llegas con la prueba escrita de que
        pediste y no te contestaron.
      </p>
    </div>`;

  const asunto = c
    ? `Constancia — tu derecho de petición a ${entidad} fue radicado`
    : `Tu derecho de petición a ${entidad} — listo para radicar`;

  const r = await enviar({
    to: usado,
    subject: asunto,
    html: `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1c1e;max-width:640px">
  ${aviso}${constanciaHtml}${bloquePlazo}
  <p style="margin:0;color:#555;font-size:13px">
    Este documento lo preparó Mijo a partir de lo que contaste. Revísalo antes de radicarlo y
    corrige cualquier dato que no esté bien. El ejercicio del derecho de petición es gratuito
    y no necesita abogado (artículo 13 de la Ley 1755 de 2015).
  </p>
</div>`.trim(),
    attachments: [{ filename: params.nombreArchivo, content: params.pdf }],
  });
  return { ...r, destinatarioUsado: usado };
}

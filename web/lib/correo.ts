/**
 * Envío de correo con Resend: la tutela a la persona, y la radicación ante la
 * Oficina Judicial de Reparto.
 *
 * Radicar por correo es una vía legal de verdad (Ley 2213 de 2022, que volvió
 * permanente la justicia digital), no un atajo. Por eso el código está completo
 * y es el que iría a producción.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE NO SE NEGOCIA
 *
 * En desarrollo y en la demo NUNCA sale un correo a una oficina judicial real.
 * Una tutela de prueba que llega a reparto ocupa un turno y consume el tiempo de
 * un juez que le corresponde a alguien con un caso de verdad — alguien que está
 * enfermo y esperando. REPARTO_OVERRIDE_EMAIL redirige el envío; el destinatario
 * real se calcula igual, se loguea igual y se muestra dentro del correo. Lo
 * único que cambia entre demo y producción es quitar esa variable.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Degradación como en lib/tts.ts y lib/stt.ts: sin API key devuelve un fallo
 * explicado y el bot sigue conversando. El correo es un extra sobre el PDF que
 * la persona YA recibió por WhatsApp; que falle no puede costarle la tutela.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { kitRadicacionHtml, type DatosKit } from "@/lib/kitRadicacion";

const API_KEY = (process.env.RESEND_API_KEY ?? "").trim();

/* Las comillas del .env se quitan aquí y no solo en quien lea el archivo: Next
 * las despoja al parsear, pero un script que lea .env.local a mano no, y Resend
 * rechaza con 422 un `from` que llegue entrecomillado. Es el error que se paga
 * con media hora de mirar un mensaje de validación que no dice de dónde viene. */
function sinComillas(v: string | undefined, porDefecto: string): string {
  const t = (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
  return t || porDefecto;
}

const FROM = sinComillas(process.env.CORREO_FROM, "Mijo <onboarding@resend.dev>");

export function correoDisponible(): boolean {
  return Boolean(API_KEY);
}

/* Resend sin dominio verificado solo entrega al correo del dueño de la cuenta,
 * así que ambos overrides existen. Se admite lista separada por comas: en la
 * demo el documento le llega a todo el equipo a la vez. */
function lista(v: string | undefined): string[] {
  return (v ?? "").replace(/^["']|["']$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
}

const OVERRIDE_REPARTO = lista(process.env.REPARTO_OVERRIDE_EMAIL);
const OVERRIDE_USUARIO = lista(process.env.USUARIO_OVERRIDE_EMAIL);

/* ── El mapa de oficinas ─────────────────────────────────────────────────── */

export interface Reparto {
  ciudad: string;
  oficina: string;
  correo: string;
  verificado: boolean;
}

let mapa: Record<string, Reparto> | null = null;

function cargarMapa(): Record<string, Reparto> {
  if (mapa) return mapa;
  try {
    const bruto = JSON.parse(
      readFileSync(join(process.cwd(), "data", "reparto.json"), "utf-8"),
    ) as Record<string, unknown>;
    const out: Record<string, Reparto> = {};
    for (const [k, v] of Object.entries(bruto)) {
      if (k.startsWith("_")) continue; // metadatos de la fuente
      out[k] = v as Reparto;
    }
    mapa = out;
  } catch (e) {
    console.error("[correo] no se pudo leer data/reparto.json:", e instanceof Error ? e.message : e);
    mapa = {};
  }
  return mapa;
}

/** "Bogotá D.C." → "bogota". Sin tildes, sin puntuación, minúsculas. */
function claveCiudad(ciudad: string): string {
  return ciudad
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\bd\.?\s?c\.?\b/g, "")   // "bogota d.c." → "bogota"
    .replace(/[^a-z\s]/g, "")
    .trim()
    .split(/\s+/)[0] ?? "";
}

/**
 * Encuentra la Oficina Judicial de Reparto de una ciudad. null si no está en el
 * mapa — y entonces la persona radica por el portal, que sirve para todo el país.
 */
export function resolverReparto(ciudad: string): Reparto | null {
  if (!ciudad?.trim()) return null;
  const m = cargarMapa();
  const r = m[claveCiudad(ciudad)];
  if (!r) return null;
  if (!r.verificado) {
    console.warn(
      `[reparto] ⚠️ ${r.ciudad}: el correo ${r.correo} NO está confirmado contra el `
      + "directorio oficial del CENDOJ. Verificar en ramajudicial.gov.co antes de radicar en producción.",
    );
  }
  return r;
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
 * solo gasta tiempo.
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
        console.warn(`[correo] fallo transitorio (${msg}), reintentando…`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      console.error("[correo] Resend rechazó el envío:", msg);
      return { ok: false, error: msg };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (intento === 0) {
        console.warn(`[correo] error de red (${msg}), reintentando…`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      console.error("[correo]", msg);
      return { ok: false, error: msg };
    }
  }
  return { ok: false, error: "agotados los reintentos" };
}

/* ── 1. La tutela, a la persona ──────────────────────────────────────────── */

/** Los datos de una radicación ya hecha, para acompañar la copia como constancia. */
export interface Constancia {
  oficina: string;
  /** A quién se radicó DE VERDAD en producción. */
  destinatarioReal: string;
  /** Adónde salió el correo en esta corrida (puede ser el buzón de pruebas). */
  destinatarioUsado: string[];
  idEnvio?: string;
  esPrueba: boolean;
}

export async function enviarTutelaAlUsuario(params: {
  para: string;
  nombre: string;
  pdf: Buffer;
  nombreArchivo: string;
  /** El kit de radicación ya armado (lib/kitRadicacion.ts). */
  kit: DatosKit;
  /** Si viene, el correo es la COPIA DE LO RADICADO, no "tu tutela está lista". */
  constancia?: Constancia;
}): Promise<{ ok: boolean; id?: string; error?: string; destinatarioUsado: string[] }> {
  const real = [params.para];
  const usado = OVERRIDE_USUARIO.length ? OVERRIDE_USUARIO : real;
  if (OVERRIDE_USUARIO.length) {
    console.log(`[correo-usuario] real=${params.para} usado=${usado.join(",")} override=sí`);
  }

  const aviso = OVERRIDE_USUARIO.length
    ? `<div style="background:#fff4d6;border:1px solid #e0b84c;padding:12px 16px;margin:0 0 20px;
         font-family:-apple-system,sans-serif;font-size:14px">
         <b>⚠️ ENVÍO DE PRUEBA</b><br>Destinatario real: <b>${params.para}</b>.
         Redirigido por <code>USUARIO_OVERRIDE_EMAIL</code> (Resend sin dominio verificado
         solo entrega al dueño de la cuenta).
       </div>`
    : "";

  const c = params.constancia;
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /* El bloque de constancia va ARRIBA del kit: quien abre este correo lo que
   * quiere saber primero es qué se mandó y a dónde. El adjunto es el MISMO
   * archivo que recibió el juzgado, no una versión parecida — si no, deja de
   * ser una constancia y pasa a ser otro documento. */
  const constanciaHtml = c
    ? `<div style="border:1px solid #cdd5cd;padding:16px 18px;margin:0 0 24px;
         font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6">
         <div style="font-size:17px;font-weight:700;margin-bottom:10px">
           ${c.esPrueba ? "Constancia de envío (PRUEBA)" : "Constancia de radicación"}
         </div>
         <table style="border-collapse:collapse">
           <tr><td style="padding:3px 12px 3px 0;color:#555">Radicada ante</td>
               <td style="padding:3px 0"><b>${esc(c.oficina)}</b></td></tr>
           <tr><td style="padding:3px 12px 3px 0;color:#555">Correo del juzgado</td>
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
           <b>El PDF adjunto es exactamente el documento que recibió el juzgado.</b>
           Guárdalo: es tu respaldo de lo que se radicó.
         </p>
         ${c.esPrueba
           ? `<p style="margin:10px 0 0;color:#8b6b20;font-size:13.5px">
                ⚠️ Envío de PRUEBA: no llegó a la oficina judicial. En producción habría
                ido a ${esc(c.destinatarioReal)}.</p>`
           : ""}
       </div>`
    : "";

  const asunto = c
    ? `Constancia — tu tutela contra ${params.kit.doc.accionado.nombre || "tu EPS"} fue radicada`
    : `Tu acción de tutela contra ${params.kit.doc.accionado.nombre || "tu EPS"} — lista para radicar`;

  const r = await enviar({
    to: usado,
    subject: asunto,
    html: aviso + constanciaHtml + kitRadicacionHtml(params.kit),
    attachments: [{ filename: params.nombreArchivo, content: params.pdf }],
  });
  return { ...r, destinatarioUsado: usado };
}

/* ── 2. La radicación ante el juzgado ────────────────────────────────────── */

export interface ResultadoRadicacion {
  ok: boolean;
  id?: string;
  /** A quién habría ido en producción. SIEMPRE se calcula, aunque haya override. */
  destinatarioReal: string | null;
  /** A quién se envió de verdad. */
  destinatarioUsado: string[];
  oficina?: string;
  error?: string;
}

export async function radicarPorCorreo(params: {
  ciudad: string;
  accionante: { nombre: string; cedula: string };
  accionado: string;
  pdf: Buffer;
  nombreArchivo: string;
  derechos?: string[];
}): Promise<ResultadoRadicacion> {
  const oficina = resolverReparto(params.ciudad);

  if (!oficina) {
    return {
      ok: false,
      destinatarioReal: null,
      destinatarioUsado: [],
      error: `no tenemos la Oficina de Reparto de "${params.ciudad}"; la persona debe radicar por el portal`,
    };
  }

  const real = oficina.correo;
  const usado = OVERRIDE_REPARTO.length ? OVERRIDE_REPARTO : [real];

  // SIEMPRE se loguean los dos. Es la línea que deja claro qué habría pasado
  // en producción y qué pasó de verdad.
  console.log(
    `[reparto] real=${real} usado=${usado.join(",")} override=${OVERRIDE_REPARTO.length ? "sí" : "no"}`,
  );

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const derechos = (params.derechos ?? ["salud"]).map(esc).join(", ");

  const avisoPrueba = OVERRIDE_REPARTO.length
    ? `<div style="background:#ffe1e1;border:2px solid #c0392b;padding:14px 18px;margin:0 0 24px;
         font-family:-apple-system,sans-serif;font-size:15px;color:#7d2018">
         <b>⚠️ ENVÍO DE PRUEBA — NO ES UNA RADICACIÓN REAL</b><br>
         Destinatario real en producción: <b>${esc(real)}</b> (${esc(oficina.oficina)}).<br>
         Este mensaje se redirigió a un buzón de pruebas y <b>no fue radicado</b>.
       </div>`
    : "";

  const advertenciaVerificado = oficina.verificado
    ? ""
    : `<p style="font-size:13px;color:#8b6b20;margin:0 0 16px">
         Nota interna: la dirección de esta oficina no está confirmada contra el directorio
         oficial del CENDOJ. Verificar antes de radicar en producción.
       </p>`;

  const r = await enviar({
    to: usado,
    subject: `ACCIÓN DE TUTELA — ${params.accionante.nombre} C.C. ${params.accionante.cedula} contra ${params.accionado}`,
    html: `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1c1e;max-width:640px">
  ${avisoPrueba}
  <p style="margin:0 0 16px">Señores<br><b>${esc(oficina.oficina)}</b><br>E. S. D.</p>

  <p style="margin:0 0 16px">
    Respetuosamente remito <b>ACCIÓN DE TUTELA</b> para reparto, en los siguientes términos:
  </p>

  <table style="border-collapse:collapse;margin:0 0 16px">
    <tr><td style="padding:4px 12px 4px 0;color:#555">Accionante</td>
        <td style="padding:4px 0"><b>${esc(params.accionante.nombre)}</b></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#555">Identificación</td>
        <td style="padding:4px 0">C.C. ${esc(params.accionante.cedula)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#555">Accionado</td>
        <td style="padding:4px 0"><b>${esc(params.accionado)}</b></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#555">Derechos invocados</td>
        <td style="padding:4px 0">${derechos}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#555">Ciudad</td>
        <td style="padding:4px 0">${esc(oficina.ciudad)}</td></tr>
  </table>

  ${advertenciaVerificado}

  <p style="margin:0 0 16px">
    <b>El escrito de tutela va adjunto en PDF.</b> Se presenta en nombre propio, sin apoderado,
    conforme al artículo 10 del Decreto 2591 de 1991, y se remite por medio electrónico
    conforme a la Ley 2213 de 2022.
  </p>

  <p style="margin:0;color:#555;font-size:13px">
    Documento preparado con asistencia de Mijo a partir del relato del accionante. La
    jurisprudencia citada fue verificada contra el texto oficial de la Corte Constitucional.
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
    oficina: oficina.oficina,
  };
}

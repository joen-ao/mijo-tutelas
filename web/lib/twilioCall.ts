/**
 * Llamadas de voz salientes con Twilio (Programmable Voice).
 *
 * Hermano de twilioSend.ts (WhatsApp), con una diferencia clave: el TwiML va
 * EN LÍNEA en el POST (parámetro `Twiml`, máx 4000 chars), así que NO hace falta
 * exponer un webhook público ni un túnel. Lo único que Twilio tiene que poder
 * alcanzar es el MP3, y eso ya lo resuelve subirAudio() contra Supabase Storage.
 *
 * La voz es la misma de WhatsApp (ElevenLabs, con acento por ciudad). Si el TTS
 * o la subida fallan, cae a la voz de Twilio: la llamada igual entra.
 *
 * Trial: solo se puede llamar a números verificados en la consola (máx 5).
 */
import { subirAudio } from "@/lib/storage";
import { sintetizarVoz, voiceIdPorCiudad } from "@/lib/tts";

const SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
// Número con capacidad de VOZ. Ojo: el de WhatsApp (sandbox) NO sirve para llamar.
const FROM = process.env.TWILIO_VOICE_FROM ?? "";

const TWIML_MAX = 4000;

export function llamadasListas(): boolean {
  return Boolean(SID && TOKEN && FROM);
}

function escaparXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Normaliza a E.164 colombiano: "3022182841" → "+573022182841". */
export function aE164(tel: string): string {
  const d = tel.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.startsWith("57")) return `+${d}`;
  return `+57${d}`;
}

/** TwiML de una llamada de un solo sentido: reproduce el audio y cuelga. */
export function twimlReproducir(audioUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>`
    + `<Pause length="1"/>`  // el audio arranca cortado si suena de inmediato
    + `<Play>${escaparXml(audioUrl)}</Play>`
    + `<Hangup/></Response>`;
}

/** Plan B si no hubo MP3: voz de Twilio en español. Peor timbre, misma llamada. */
export function twimlDecir(texto: string): string {
  // El presupuesto del <Say> sale de restarle al tope los tags que lo envuelven.
  const envoltura = `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/>`
    + `<Say voice="Polly.Mia" language="es-MX"></Say><Hangup/></Response>`;
  const cuerpo = escaparXml(texto).slice(0, TWIML_MAX - envoltura.length);
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/>`
    + `<Say voice="Polly.Mia" language="es-MX">${cuerpo}</Say>`
    + `<Hangup/></Response>`;
}

export interface ResultadoLlamada {
  ok: boolean;
  callSid?: string;
  /** "elevenlabs" = sonó la voz buena; "twilio" = cayó al plan B. */
  voz?: "elevenlabs" | "twilio";
  error?: string;
}

/**
 * Llamada CONVERSACIONAL: Twilio pide el TwiML a `url` en cada turno.
 * Requiere URL pública (ngrok / deploy) — es el modo del asesor por voz.
 */
export async function llamarConUrl(to: string, url: string): Promise<ResultadoLlamada> {
  return crearLlamada(to, { Url: url });
}

/** POST crudo a la API de Calls con TwiML en línea (un solo sentido, sin webhook). */
export async function llamarConTwiml(to: string, twiml: string): Promise<ResultadoLlamada> {
  if (twiml.length > TWIML_MAX) return { ok: false, error: `TwiML de ${twiml.length} chars (máx ${TWIML_MAX})` };
  return crearLlamada(to, { Twiml: twiml });
}

async function crearLlamada(to: string, extra: Record<string, string>): Promise<ResultadoLlamada> {
  if (!llamadasListas()) return { ok: false, error: "Faltan TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VOICE_FROM" };

  const params = new URLSearchParams();
  params.set("To", aE164(to));
  params.set("From", FROM);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  params.set("Timeout", "25");
  // OJO: aquí NO va MachineDetection. Con AMD activo Twilio NO pide el TwiML
  // hasta terminar de analizar si contestó humano o contestadora, y mientras
  // tanto la persona escucha SILENCIO. Verificado en vivo: contestó, esperó,
  // no oyó nada y colgó a los 19 s — nuestro webhook nunca llegó a dispararse.
  // Si algún día hace falta AMD, va con AsyncAmd=true para que no bloquee.

  try {
    const auth = "Basic " + Buffer.from(`${SID}:${TOKEN}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Calls.json`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Twilio explica el motivo real; en trial lo típico es el 21219 (no verificado).
      const detalle = `${body.code ?? res.status}: ${body.message ?? res.statusText}`;
      console.error(`[twilio-voz] llamada falló → ${detalle}`);
      console.error(`[twilio-voz] To=${aE164(to)} From=${FROM}`);
      return { ok: false, error: detalle };
    }
    return { ok: true, callSid: body.sid };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[twilio-voz] error de red llamando:", msg);
    return { ok: false, error: msg };
  }
}

/**
 * Llama y le lee `texto` a la persona con la voz del asesor.
 * `ciudad` elige el acento (paisa / costeño / rolo / neutral), igual que WhatsApp.
 */
export async function llamarConVoz(
  to: string, texto: string, opts: { ciudad?: string | null } = {},
): Promise<ResultadoLlamada> {
  const buf = await sintetizarVoz(texto, voiceIdPorCiudad(opts.ciudad));
  const audioUrl = buf ? await subirAudio(buf) : null;

  if (audioUrl) {
    const r = await llamarConTwiml(to, twimlReproducir(audioUrl));
    return { ...r, voz: "elevenlabs" };
  }
  console.warn("[twilio-voz] sin MP3 (TTS o Storage falló) → voz de Twilio");
  const r = await llamarConTwiml(to, twimlDecir(texto));
  return { ...r, voz: "twilio" };
}

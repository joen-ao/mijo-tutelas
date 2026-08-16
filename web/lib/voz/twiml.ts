/**
 * Constructores de TwiML para la llamada conversacional.
 *
 * La llamada es un ping-pong: cada respuesta nuestra termina en un <Gather> que
 * escucha, y Twilio hace POST a `action` con lo que la persona dijo (SpeechResult).
 * Twilio se encarga del reconocimiento de voz — <Record> está bloqueado en trial,
 * pero <Gather input="speech"> no, y es justo lo que necesitamos.
 */

const MAX_SAY = 3000;

/**
 * Limpia texto pensado para WhatsApp antes de mandarlo a la voz.
 *
 * Las preguntas del cerebro vienen con emojis, *negritas* y a veces links —
 * perfecto para chat, pésimo por teléfono: ElevenLabs los vocaliza LITERAL
 * (verificado: lee "asterisco", la barra de "Tranqui/a" y la URL entera).
 */
export function limpiarParaVoz(s: string): string {
  return s
    .replace(/https?:\/\/\S+/g, "")                 // links: no se leen por teléfono
    .replace(/\p{Extended_Pictographic}/gu, "")     // emojis
    .replace(/[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu, "") // modificadores de emoji
    .replace(/[*_~`]/g, "")                         // markup de WhatsApp
    .replace(/([a-záéíóúñ])\/a\b/gi, "$1")          // "Tranqui/a" -> "Tranqui"
    .replace(/\s*\n+\s*/g, ". ")                    // saltos de línea -> pausa
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:?!])/g, "$1")
    .trim();
}

export function xmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Voz de respaldo de Twilio, cuando ElevenLabs o Storage fallan. */
function decir(texto: string): string {
  return `<Say voice="Polly.Mia" language="es-MX">${xmlEsc(texto.slice(0, MAX_SAY))}</Say>`;
}

/** Reproduce el MP3 de ElevenLabs; si no hay, cae a la voz de Twilio. */
function hablar(audioUrl: string | null, texto: string): string {
  return audioUrl ? `<Play>${xmlEsc(audioUrl)}</Play>` : decir(texto);
}

const XML = `<?xml version="1.0" encoding="UTF-8"?>`;

/**
 * Cómo escuchar en este turno. Salió de una llamada real:
 *
 *  · "voz"      — lo normal. speechTimeout="auto" corta cuando deja de hablar.
 *  · "numeros"  — cédula. Dictar diez dígitos es pedirle a Twilio que adivine;
 *                 con el TECLADO no hay reconocimiento que falle. Se acepta voz
 *                 igual, por si la persona no puede o no quiere marcar.
 *  · "deletreo" — correo. Aquí "auto" es un ERROR: quien deletrea hace pausas
 *                 entre letra y letra, Twilio las lee como fin de frase y corta
 *                 a mitad. Timeout fijo y largo, y la almohadilla para cerrar.
 */
export type ModoEscucha = "voz" | "numeros" | "deletreo";

export interface TurnoVoz {
  audioUrl: string | null;
  texto: string;
  action: string;
  modo?: ModoEscucha;
}

/**
 * Habla y ESCUCHA la respuesta.
 * - `speechTimeout="auto"` corta cuando la persona deja de hablar (no a los N seg).
 * - `actionOnEmptyResult` hace que Twilio nos avise aunque no haya dicho nada,
 *   para poder repetir la pregunta en vez de colgar en seco.
 * - `bargeIn` implícito: si habla encima del audio, Twilio lo corta y escucha.
 */
export function twimlPreguntar({ audioUrl, texto, action, modo = "voz" }: TurnoVoz): string {
  /* speechTimeout en segundos (no "auto") cuando se espera algo entrecortado:
   * un correo deletreado o una cédula dicha dígito por dígito. "auto" corta en
   * la primera pausa y la persona se queda a mitad de palabra. */
  const attrs = modo === "numeros"
    ? `input="dtmf speech" numDigits="12" finishOnKey="#" timeout="12" speechTimeout="5"`
    : modo === "deletreo"
      ? `input="dtmf speech" finishOnKey="#" timeout="12" speechTimeout="6"`
      : `input="speech" speechTimeout="auto" timeout="6"`;

  return `${XML}<Response>`
    + `<Gather ${attrs} language="es-CO" speechModel="phone_call"`
    + ` actionOnEmptyResult="true" action="${xmlEsc(action)}" method="POST">`
    + hablar(audioUrl, texto)
    + `</Gather></Response>`;
}

/** Habla y cuelga (cierre de la llamada). */
export function twimlDespedir(audioUrl: string | null, texto: string): string {
  return `${XML}<Response><Pause length="1"/>${hablar(audioUrl, texto)}<Hangup/></Response>`;
}

/** Saludo inicial: pausa breve para que no se corte la primera sílaba. */
export function twimlSaludar(t: TurnoVoz): string {
  return twimlPreguntar(t).replace("<Response>", "<Response><Pause length=\"1\"/>");
}

/** No se le entendió / no dijo nada: repite sin sonar a disco rayado. */
export function twimlReintentar(t: TurnoVoz): string {
  return twimlPreguntar(t);
}

/**
 * T27 · Verificación de la firma de Twilio en el webhook de WhatsApp.
 *
 * `/api/whatsapp` es la única ruta que TIENE que seguir siendo pública: la llama
 * Twilio, no un humano. Sin verificar, cualquiera puede forjar mensajes
 * entrantes, abrir casos y quemar créditos de Gemini y ElevenLabs.
 *
 * Algoritmo (documentado por Twilio): se concatena la URL exacta que Twilio
 * pidió + cada par clave/valor del POST ordenado por clave, se firma con
 * HMAC-SHA1 usando el auth token y se compara en base64 contra
 * `X-Twilio-Signature`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Se verifica cuando hay token Y estamos expuestos a internet. En local con
 * curl (sin firma) se deja pasar, para no romper las pruebas de siempre.
 * `WHATSAPP_VERIFY_SIGNATURE=true|false` fuerza el comportamiento.
 */
export function debeVerificarFirma(): boolean {
  const forzado = process.env.WHATSAPP_VERIFY_SIGNATURE?.trim().toLowerCase();
  if (forzado === "true") return true;
  if (forzado === "false") return false;
  const enInternet = Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
  return enInternet && Boolean(process.env.TWILIO_AUTH_TOKEN);
}

/** URL pública tal como la vio Twilio (detrás de ngrok/Vercel el host va en headers). */
export function urlPublica(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const { pathname, search } = new URL(req.url);
  return `${proto}://${host}${pathname}${search}`;
}

export function firmaValida(url: string, params: Record<string, string>, firma: string): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN ?? "";
  if (!token || !firma) return false;

  const base = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  const esperada = createHmac("sha1", token).update(Buffer.from(base, "utf-8")).digest("base64");

  const a = Buffer.from(esperada);
  const b = Buffer.from(firma);
  return a.length === b.length && timingSafeEqual(a, b);
}

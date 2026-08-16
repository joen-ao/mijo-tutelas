import { llamadasListas, llamarConUrl } from "@/lib/twilioCall";

/**
 * GET /api/dev/llamada-asesor?to=+57...&base=https://xxx.ngrok-free.app
 *
 * Llama y CONVERSA. A diferencia de /api/dev/llamada-demo —que lee un texto y
 * cuelga— esta abre el canal conversacional: Twilio pide el TwiML a
 * /api/voz/twiml en cada turno, así que necesita la URL pública de ngrok.
 *
 * Es el canal para quien no tiene WhatsApp: la persona solo contesta y habla.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const to = url.searchParams.get("to");
  if (!to) return Response.json({ error: "falta ?to=+57..." }, { status: 400 });
  if (!llamadasListas()) return Response.json({ error: "faltan credenciales de voz" }, { status: 503 });

  /* La base tiene que ser la PÚBLICA (ngrok), no localhost: en este modo es
   * Twilio quien viene a buscarnos en cada turno de la conversación. */
  const base = url.searchParams.get("base")
    ?? `${req.headers.get("x-forwarded-proto") ?? "https"}://${req.headers.get("host")}`;

  const r = await llamarConUrl(to, `${base}/api/voz/twiml`);
  return Response.json({ ...r, webhook: `${base}/api/voz/twiml` });
}

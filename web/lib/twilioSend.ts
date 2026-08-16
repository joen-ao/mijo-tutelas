/**
 * Envío saliente por la API de Twilio (WhatsApp).
 *
 * Se usa para responder de forma ASÍNCRONA: el webhook contesta al instante
 * (para no toparse con el timeout de 15s de Twilio) y el mensaje real —que puede
 * tardar por Gemini + voz— se manda después con esta función.
 */
const SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const FROM = process.env.TWILIO_WHATSAPP_FROM ?? "";

export function twilioListo(): boolean {
  return Boolean(SID && TOKEN && FROM);
}

/**
 * Muestra "escribiendo…" en el WhatsApp del cliente (T25).
 *
 * Se referencia el SID del mensaje ENTRANTE al que estamos respondiendo; Twilio
 * lo marca como leído y prende el indicador. Dura hasta 25 s o hasta que llega
 * la respuesta, lo que pase primero, así que en respuestas largas hay que
 * repetirlo.
 *
 * Nota honesta: WhatsApp solo expone "escribiendo". NO existe un indicador de
 * "grabando audio" en la API, así que las notas de voz también se anuncian con
 * este. Docs: twilio.com/docs/whatsapp/api/typing-indicators-resource
 */
export async function mostrarEscribiendo(messageId: string): Promise<boolean> {
  if (!twilioListo() || !messageId || !/^(SM|MM)/.test(messageId)) return false;
  try {
    const auth = "Basic " + Buffer.from(`${SID}:${TOKEN}`).toString("base64");
    const res = await fetch("https://messaging.twilio.com/v3/Indicators/Typing.json", {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "WHATSAPP", messageId }),
    });
    if (!res.ok) {
      const detalle = await res.text().catch(() => res.statusText);
      console.warn(`[twilio] indicador de escritura ${res.status} → ${detalle.slice(0, 200)}`);
    }
    return res.ok;
  } catch (e) {
    // Es cosmético: si falla, el bot responde igual.
    console.warn("[twilio] indicador de escritura falló:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Envía un mensaje de WhatsApp (texto y/o media) al número `to`. */
export async function enviarWhatsApp(
  to: string, opts: { body?: string; mediaUrl?: string },
): Promise<boolean> {
  return (await enviarWhatsAppDetalle(to, opts)).ok;
}

/** Igual que `enviarWhatsApp` pero devuelve también el SID del mensaje, para
 *  poder esperar su ENTREGA (no solo su encolado) antes de mandar el siguiente. */
export async function enviarWhatsAppDetalle(
  to: string, opts: { body?: string; mediaUrl?: string },
): Promise<{ ok: boolean; sid: string | null }> {
  if (!twilioListo() || !to) return { ok: false, sid: null };
  try {
    const params = new URLSearchParams();
    params.set("To", to);
    params.set("From", FROM);
    if (opts.body) params.set("Body", opts.body);
    if (opts.mediaUrl) params.set("MediaUrl", opts.mediaUrl);
    const auth = "Basic " + Buffer.from(`${SID}:${TOKEN}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!res.ok) {
      // Logueamos el motivo REAL de Twilio (antes fallaba en silencio).
      const detalle = await res.text().catch(() => res.statusText);
      console.error(`[twilio] envío falló ${res.status} → ${detalle.slice(0, 400)}`);
      console.error(`[twilio] To=${to} From=${FROM} ${opts.mediaUrl ? "media=" + opts.mediaUrl : "texto"}`);
      return { ok: false, sid: null };
    }
    const json = (await res.json().catch(() => null)) as { sid?: string } | null;
    return { ok: true, sid: json?.sid ?? null };
  } catch (e) {
    console.error("[twilio] error de red enviando:", e instanceof Error ? e.message : e);
    return { ok: false, sid: null };
  }
}

/**
 * Espera a que un mensaje (típicamente el AUDIO) esté realmente ENTREGADO antes
 * de soltar el texto que lo sigue. Twilio acepta la media al instante (queued)
 * pero tarda en descargarla y entregarla al teléfono; el texto —instantáneo— le
 * ganaba. Consultamos el estado del mensaje hasta que llega a `sent`/`delivered`
 * /`read` (ya salió hacia WhatsApp) o hasta agotar el tope. Devuelve al primer
 * estado bueno; si Twilio se demora, no bloquea para siempre.
 */
export async function esperarEntregaWhatsApp(
  sid: string, opts: { hastaMs?: number; pasoMs?: number } = {},
): Promise<void> {
  if (!twilioListo() || !sid) return;
  const hastaMs = opts.hastaMs ?? 12000;
  const pasoMs = opts.pasoMs ?? 1000;
  const auth = "Basic " + Buffer.from(`${SID}:${TOKEN}`).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages/${sid}.json`;
  const inicio = Date.now();
  // Estados en los que el mensaje YA salió hacia el teléfono → podemos seguir.
  const listos = new Set(["sent", "delivered", "read"]);
  const fallidos = new Set(["failed", "undelivered"]);
  while (Date.now() - inicio < hastaMs) {
    await new Promise((r) => setTimeout(r, pasoMs));
    try {
      const res = await fetch(url, { headers: { Authorization: auth } });
      if (!res.ok) return; // no podemos consultar → mejor no bloquear
      const json = (await res.json()) as { status?: string };
      const st = json.status ?? "";
      if (listos.has(st) || fallidos.has(st)) return;
    } catch {
      return; // error de red al consultar → seguimos sin bloquear
    }
  }
}

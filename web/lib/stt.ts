/**
 * Speech-to-Text con ElevenLabs Scribe — para que el cliente pueda MANDAR notas
 * de voz por WhatsApp y el asesor las entienda.
 *
 * Descarga el audio de Twilio (media protegida con basic auth) y lo transcribe.
 * Si no hay key o falla, devuelve null → el webhook pide repetir/escribir.
 */
const STT_KEY = process.env.ELEVENLABS_API_KEY ?? "";
const TW_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";

export function sttDisponible(): boolean {
  return Boolean(STT_KEY);
}

/** Descarga el audio de una MediaUrl de Twilio y lo transcribe con Scribe. */
export async function transcribirAudioTwilio(
  mediaUrl: string, contentType: string,
): Promise<string | null> {
  if (!STT_KEY || !mediaUrl) return null;
  try {
    // 1) descargar el audio de Twilio (basic auth; redirige a URL firmada)
    const headers: Record<string, string> = {};
    if (TW_SID && TW_TOKEN) {
      headers.Authorization = "Basic " + Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString("base64");
    }
    const dl = await fetch(mediaUrl, { headers });
    if (!dl.ok) return null;
    const buf = Buffer.from(await dl.arrayBuffer());

    // 2) transcribir con ElevenLabs Scribe
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: contentType || "audio/ogg" }), "audio");
    fd.append("model_id", "scribe_v1");
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST", headers: { "xi-api-key": STT_KEY }, body: fd,
    });
    if (!res.ok) return null;
    const j = await res.json();
    const texto = String(j?.text ?? "").trim();
    return texto || null;
  } catch {
    return null;
  }
}

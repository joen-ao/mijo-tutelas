/**
 * Text-to-Speech con ElevenLabs (voz del asesor por WhatsApp).
 *
 * Solo se usa en momentos clave (saludo + resultado). Si no hay
 * ELEVENLABS_API_KEY, devuelve null → el bot manda solo texto (degradación).
 */

const KEY = process.env.ELEVENLABS_API_KEY ?? "";
// Voz por defecto = BOGOTÁ/Cundinamarca (rola). Cambiar con ELEVENLABS_VOICE_ID.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL";
const MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2";

// Voces por ACENTO regional (la voz habla con el acento de la ciudad de la persona).
const VOZ_PAISA = process.env.ELEVENLABS_VOICE_PAISA ?? "JcWDFG8DiES2OzGhZJUJ";     // Antioquia / eje cafetero
const VOZ_NEUTRAL = process.env.ELEVENLABS_VOICE_NEUTRAL ?? "we7iQjsiEsz1mFYw1Snx"; // pueblo / otra región / Costa
// La Costa usa la voz NEUTRAL (no tenemos una costeña que convenza). Configurable
// aparte por si luego se consigue una buena; por defecto = neutral.
const VOZ_COSTA = process.env.ELEVENLABS_VOICE_COSTA ?? VOZ_NEUTRAL;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const PAISA = ["medellin", "bello", "envigado", "itagui", "sabaneta", "rionegro", "apartado", "manizales", "pereira", "armenia"];
const COSTA = ["barranquilla", "cartagena", "santa marta", "monteria", "valledupar", "sincelejo", "riohacha", "soledad", "malambo"];
const BOGOTA = ["bogota", "soacha", "chia", "zipaquira", "facatativa", "fusagasuga", "girardot", "mosquera", "madrid", "funza", "cajica", "cota"];

/** Voz de ElevenLabs según la CIUDAD de la persona (acento paisa/costeño/rolo/neutral). */
export function voiceIdPorCiudad(ciudad?: string | null): string {
  if (!ciudad) return VOICE_ID;
  const c = norm(ciudad);
  if (PAISA.some((x) => c.includes(x))) return VOZ_PAISA;
  if (COSTA.some((x) => c.includes(x))) return VOZ_COSTA;
  if (BOGOTA.some((x) => c.includes(x))) return VOICE_ID; // rola/bogotana (voz actual)
  return VOZ_NEUTRAL; // cualquier otro lugar → neutral/pueblo
}

export function ttsDisponible(): boolean {
  return Boolean(KEY);
}

/**
 * TTS para LLAMADAS: la persona está esperando en la línea, así que prima la
 * latencia sobre el timbre. Con `eleven_turbo_v2_5` a 22 kHz/32 kbps son ~335 ms
 * en vez de ~1.400, y el MP3 baja de 73 KB a 19 — y da igual, porque Twilio
 * remuestrea todo a 8 kHz de todos modos.
 */
const MODEL_VOZ = process.env.ELEVENLABS_MODEL_VOZ ?? "eleven_turbo_v2_5";
const FORMATO_VOZ = "mp3_22050_32";

export async function sintetizarVozRapida(texto: string, voiceId?: string): Promise<Buffer | null> {
  if (!KEY || !texto.trim()) return null;
  const voz = voiceId || VOICE_ID;
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voz}?output_format=${FORMATO_VOZ}`,
      {
        method: "POST",
        headers: { "xi-api-key": KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({
          text: texto.slice(0, 2500),
          model_id: MODEL_VOZ,
          voice_settings: { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: true },
        }),
      },
    );
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    console.error(`[tts-voz] ElevenLabs ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  } catch (e) {
    console.error("[tts-voz] red:", e instanceof Error ? e.message : e);
  }
  return null; // el TwiML cae a <Say>: la llamada no se cae por esto
}

/** Sintetiza texto a MP3. Devuelve el Buffer o null si falla / no hay key.
 *  Reintenta una vez ante fallos transitorios (429 rate-limit, 5xx, red) y
 *  LOGUEA el motivo real: antes fallaba en silencio y el bot caía a texto sin
 *  saber por qué. ElevenLabs limita el tamaño por request → truncamos por si acaso. */
export async function sintetizarVoz(texto: string, voiceId?: string): Promise<Buffer | null> {
  if (!KEY || !texto.trim()) return null;
  const clean = texto.slice(0, 2500); // margen holgado bajo el límite por request
  const voz = voiceId || VOICE_ID;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voz}?output_format=mp3_44100_128`;

  for (let intento = 1; intento <= 2; intento++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({
          text: clean,
          model_id: MODEL,
          voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
        }),
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());

      const detalle = await res.text().catch(() => res.statusText);
      console.error(`[tts] ElevenLabs ${res.status} (intento ${intento}): ${detalle.slice(0, 300)}`);
      // 4xx que no sea rate-limit → no tiene sentido reintentar (key/permiso/voz).
      if (res.status !== 429 && res.status < 500) return null;
    } catch (e) {
      console.error(`[tts] error de red (intento ${intento}):`, e instanceof Error ? e.message : e);
    }
    if (intento === 1) await new Promise((r) => setTimeout(r, 600)); // respiro antes del retry
  }
  return null;
}

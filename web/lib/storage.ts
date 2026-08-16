/**
 * Sube audios TTS a Supabase Storage (bucket público 'audios') y devuelve la URL
 * pública para que Twilio la adjunte a WhatsApp. Robusto (no depende de ngrok).
 *
 * Requiere el bucket 'audios' público (migración 0002). Si Supabase no está
 * configurado o falla la subida, devuelve null → el webhook cae al plan local.
 */
import { randomUUID } from "node:crypto";

import { getSupabase } from "@/lib/supabase";

const BUCKET = "audios";

export async function subirAudio(buf: Buffer): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const path = `${randomUUID()}.mp3`;
    const { error } = await sb.storage.from(BUCKET).upload(path, buf, {
      contentType: "audio/mpeg", upsert: false,
    });
    if (error) return null;
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

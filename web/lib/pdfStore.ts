/**
 * Almacén temporal de PDFs (en memoria) para que Twilio los descargue —
 * mismo patrón que imgStore y audioStore. Se sirven vía /api/pdf/[id].
 *
 * El TTL es más largo que el de las imágenes (1 h contra 15 min): un PDF de
 * tutela es el entregable, y si la entrega se reintenta o la persona vuelve a
 * pedirlo un rato después, el enlace debería seguir sirviendo.
 */
import { randomUUID } from "node:crypto";

import { getSupabase } from "@/lib/supabase";

interface Entry { buf: Buffer; exp: number; }
const g = globalThis as unknown as { __pdfs?: Map<string, Entry> };
const pdfs: Map<string, Entry> = g.__pdfs ?? (g.__pdfs = new Map());

const TTL_MS = 60 * 60 * 1000;

export function guardarPdf(buf: Buffer): string {
  const id = randomUUID();
  pdfs.set(id, { buf, exp: Date.now() + TTL_MS });
  for (const [k, v] of pdfs) if (v.exp < Date.now()) pdfs.delete(k); // limpieza perezosa
  return id;
}

export function obtenerPdf(id: string): Buffer | null {
  const e = pdfs.get(id);
  if (!e || e.exp < Date.now()) return null;
  return e.buf;
}

/**
 * Sube la tutela al bucket público 'documentos' y devuelve su URL.
 *
 * Mismo patrón que subirAudio() en lib/storage.ts, y por la misma razón: para
 * adjuntar el PDF, Twilio tiene que DESCARGARLO desde una URL alcanzable. Con
 * el respaldo local esa URL sale por ngrok, y ngrok en plan free es lento y se
 * cae — justo con el archivo que es el entregable del producto. Desde Supabase
 * es una URL pública y estable.
 *
 * Best-effort: si Supabase no está configurado o la subida falla, devuelve null
 * y quien llama se queda con /api/pdf/[id].pdf, que sigue funcionando. Nunca
 * lanza: que el almacenamiento tenga un mal día no puede costar la entrega.
 */
export async function subirPdf(buf: Buffer): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const path = `${randomUUID()}.pdf`;
    const { error } = await sb.storage.from("documentos").upload(path, buf, {
      contentType: "application/pdf", upsert: false,
    });
    if (error) return null;
    const { data } = sb.storage.from("documentos").getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

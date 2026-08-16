/**
 * Almacén temporal de audios TTS (en memoria) para que Twilio los descargue.
 * Se sirven vía /api/audio/[id]. Expiran a los ~10 min (demo; Redis/Storage en prod).
 */
import { randomUUID } from "node:crypto";

interface Entry { buf: Buffer; exp: number; }
const g = globalThis as unknown as { __audios?: Map<string, Entry> };
const audios: Map<string, Entry> = g.__audios ?? (g.__audios = new Map());

const TTL_MS = 10 * 60 * 1000;

export function guardarAudio(buf: Buffer): string {
  const id = randomUUID();
  audios.set(id, { buf, exp: Date.now() + TTL_MS });
  // limpieza perezosa
  for (const [k, v] of audios) if (v.exp < Date.now()) audios.delete(k);
  return id;
}

export function obtenerAudio(id: string): Buffer | null {
  const e = audios.get(id);
  if (!e || e.exp < Date.now()) return null;
  return e.buf;
}

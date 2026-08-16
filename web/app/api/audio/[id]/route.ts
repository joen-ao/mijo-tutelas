import { obtenerAudio } from "@/lib/audioStore";

/** GET /api/audio/[id] — sirve el MP3 TTS para que Twilio lo adjunte a WhatsApp. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const buf = obtenerAudio(id.replace(/\.mp3$/, ""));
  if (!buf) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "audio/mpeg", "Content-Length": String(buf.length), "Cache-Control": "public, max-age=600" },
  });
}

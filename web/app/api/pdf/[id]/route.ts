import { obtenerPdf } from "@/lib/pdfStore";

/** GET /api/pdf/[id] — sirve la tutela para que Twilio la adjunte a WhatsApp. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const buf = obtenerPdf(id.replace(/\.pdf$/, ""));
  if (!buf) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(buf.length),
      // inline y con nombre: WhatsApp lo muestra así en la burbuja del archivo.
      "Content-Disposition": 'inline; filename="accion-de-tutela.pdf"',
      "Cache-Control": "public, max-age=900",
    },
  });
}

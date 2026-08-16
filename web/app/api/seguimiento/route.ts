import {
  mensajeDeSeguimiento, marcarSeguimiento, seguimientosVencidos,
} from "@/lib/seguimiento";
import { enviarWhatsApp, twilioListo } from "@/lib/twilioSend";

/**
 * POST /api/seguimiento — recorre los seguimientos vencidos y escribe.
 *
 * Se dispara desde fuera: un cron (Vercel Cron, GitHub Actions, cron-job.org) o
 * a mano. No hay temporizador interno a propósito — en un proceso Node que se
 * reinicia, un setInterval se pierde en silencio y nadie se entera de que los
 * recordatorios dejaron de salir hace tres días.
 *
 * Va protegida con token porque es una ruta que ESCRIBE a la gente: sin él,
 * cualquiera que dé con la URL puede spamear a todos los usuarios.
 *
 *   curl -X POST https://<host>/api/seguimiento \
 *        -H "Authorization: Bearer $SEGUIMIENTO_TOKEN"
 *
 * Sin SEGUIMIENTO_TOKEN configurado la ruta responde 503 y no hace nada. Es
 * deliberado: una ruta que manda mensajes no puede quedar abierta por olvido.
 */
export async function POST(req: Request) {
  const token = process.env.SEGUIMIENTO_TOKEN?.trim();
  if (!token) {
    return Response.json(
      { error: "SEGUIMIENTO_TOKEN no está configurado; la ruta queda cerrada." },
      { status: 503 },
    );
  }

  const enviado = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (enviado !== token) return Response.json({ error: "no autorizado" }, { status: 401 });

  if (!twilioListo()) {
    return Response.json({ error: "Twilio no está configurado" }, { status: 503 });
  }

  const vencidos = await seguimientosVencidos();
  const resultados: Array<{ id: string; telefono: string; ok: boolean }> = [];

  for (const s of vencidos) {
    const ok = await enviarWhatsApp(s.telefono, { body: mensajeDeSeguimiento(s) })
      .then(() => true)
      .catch((e) => { console.error("[seguimiento] envío falló:", e); return false; });

    /* Se marca como avisado aunque el envío falle: si la ventana de 24h de
     * WhatsApp está cerrada no hay nada que reintentar, y dejarlo pendiente
     * haría que la próxima corrida lo intente otra vez para siempre. */
    if (ok) await marcarSeguimiento(s.id, { estado: "avisado", avisado_at: new Date().toISOString() });
    resultados.push({ id: s.id, telefono: s.telefono, ok });
  }

  console.log(`[seguimiento] ${resultados.filter((r) => r.ok).length}/${vencidos.length} avisos enviados`);
  return Response.json({ vencidos: vencidos.length, enviados: resultados.filter((r) => r.ok).length, resultados });
}

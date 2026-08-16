/**
 * Acumula lo que la persona va contando, se lo pasa al motor de reglas y
 * persiste el veredicto cuando el caso queda listo.
 *
 * Lo usa el webhook de WhatsApp. La forma del sobre que devuelve —status y
 * next_question— viene del microservicio que había antes; se conservó para no
 * tocar el webhook cuando el cerebro pasó a ser un motor de reglas local.
 */
import { perfilar } from "@/lib/ml";
import { getLead, updateLead } from "@/lib/store";
import type { Ruteo } from "@/lib/types";

export async function perfilarLead(
  leadId: string,
  nuevasRespuestas: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const lead = await getLead(leadId);
  if (!lead) return null;

  const acumuladas = { ...lead.respuestas, ...nuevasRespuestas };
  await updateLead(leadId, { respuestas: acumuladas, estado_flujo: "perfilando" });

  const ml = await perfilar({
    caso_id: leadId,
    canal: lead.canal,
    identidad: { cedula: lead.cedula, nombre: lead.nombre, telefono: lead.telefono },
    consentimiento: lead.consentimiento,
    respuestas: acumuladas,
  });

  if (ml.status === "qualified") {
    await updateLead(leadId, {
      score: ml.score as number,
      probabilidad: ml.probabilidad as number,
      ruteo: ml.ruteo as Ruteo,
      destino: ml.destino as "radicar" | "no_procede" | "falta_informacion",
      reglas: (ml.explicacion_shap as never) ?? [],
      estado_flujo: "listo",
    });
  }
  return ml;
}

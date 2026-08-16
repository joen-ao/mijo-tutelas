import { guionLlamada, llamadasListas, llamarYLeerTutela } from "@/lib/llamada";
import type { Tutela } from "@/lib/tutela";

/**
 * GET /api/dev/llamada-demo?to=+57...  — llama y lee una tutela de ejemplo.
 *
 * Con ?solo-guion=1 imprime el texto sin llamar, para revisarlo sin gastar una
 * llamada ni molestar a nadie.
 *
 * OJO con la cuenta trial: Twilio solo permite llamar a números VERIFICADOS en
 * la consola (Phone Numbers → Verified Caller IDs). Si el número no está
 * verificado, la llamada se rechaza y aquí se ve el error exacto.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const to = url.searchParams.get("to") ?? "";

  const doc: Tutela = {
    accionante: {
      nombre: "Claudia Patricia Moreno Sáenz", cedula: "39785412", ciudad: "Bogotá",
      telefono: to, correo: "claudia.test@gmail.com",
    },
    accionado: { nombre: "Nueva EPS", tipo: "EPS" },
    hechos: [
      { numero: 1, texto: "El neumólogo ordenó oxígeno domiciliario.", fecha: "12 de junio" },
      { numero: 2, texto: "La EPS no ha autorizado el concentrador.", fecha: null },
      { numero: 3, texto: "La accionante ha reclamado en dos oportunidades.", fecha: null },
    ],
    derechos_vulnerados: ["salud", "vida digna"],
    pretensiones: ["ORDENAR la entrega del concentrador de oxígeno en 48 horas."],
    fundamentos: [],
    medida_provisional: true,
    razon_urgencia: "tiene 74 años y depende de oxígeno permanente",
    que_negaron: "el concentrador de oxígeno domiciliario",
    diagnostico: "insuficiencia respiratoria",
    fecha: new Date().toISOString(),
  };

  const guion = guionLlamada(doc, { oficina: "Oficina Judicial de Reparto de Bogotá" });

  if (url.searchParams.get("solo-guion") === "1" || !to) {
    return Response.json({
      llamadasListas: llamadasListas(),
      palabras: guion.split(/\s+/).length,
      segundosAprox: Math.round(guion.split(/\s+/).length / 2.6), // ~155 palabras/min
      guion,
      nota: to ? undefined : "pasa ?to=+57... para llamar de verdad",
    });
  }

  const r = await llamarYLeerTutela(to, doc, { oficina: "Oficina Judicial de Reparto de Bogotá" });
  return Response.json({ ...r, palabras: guion.split(/\s+/).length });
}

import { guardarPdf } from "@/lib/pdfStore";
import { construirPeticion, guardarPeticion, vencimiento } from "@/lib/peticion";
import { generarTutelaPdf } from "@/lib/tutelaPdf";

/**
 * GET /api/dev/peticion-demo — arma un derecho de petición y lo imprime.
 *
 * El equivalente de /api/dev/tutela-demo para la otra vía: sirve para ver el
 * documento sin pasar por WhatsApp, iterar la maqueta y grabar la demo.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);

  const doc = construirPeticion({
    hechos: [
      { numero: 1, texto: "La peticionaria se encuentra afiliada a Sanitas EPS en el régimen contributivo.", fecha: null },
      { numero: 2, texto: "Su médico tratante le ordenó una valoración por dermatología.", fecha: "10 de julio" },
      { numero: 3, texto: "Ha solicitado la asignación de la cita por la línea de atención sin obtener respuesta.", fecha: null },
      { numero: 4, texto: "A la fecha no se le ha asignado la cita ni se le ha informado el motivo.", fecha: null },
    ],
    tipo: (url.searchParams.get("tipo") as "general" | "documentos_informacion" | "consulta") ?? "general",
    entidad: { nombre: url.searchParams.get("eps") ?? "Sanitas EPS", tipo: "EPS", correo: null },
    peticionario: {
      nombre: "Laura Gómez Restrepo",
      cedula: "1017234567",
      ciudad: url.searchParams.get("ciudad") ?? "Medellín",
      telefono: "+57 301 418 4466",
      correo: "laura.test@gmail.com",
    },
    que_pide: url.searchParams.get("que_pide") ?? "la asignación de la cita con dermatología",
    diagnostico: null,
  });

  const id = guardarPeticion(doc);
  const t0 = Date.now();
  const pdf = await generarTutelaPdf(id, true, "peticion");
  const v = vencimiento(doc);

  return Response.json({
    ms: Date.now() - t0,
    verHtml: `/peticion?id=${id}`,
    verPdf: pdf ? `/api/pdf/${guardarPdf(pdf)}.pdf` : null,
    bytesPdf: pdf?.length ?? 0,
    tipo: doc.tipo,
    plazoDiasHabiles: v.dias,
    maximoConProrroga: v.maximo,
    venceAprox: v.fecha.toISOString().slice(0, 10),
  });
}

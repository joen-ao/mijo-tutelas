import { armarTutela, fraseEstadistica } from "@/lib/armarTutela";

/**
 * GET /api/dev/tutela-demo — corre la cadena COMPLETA sobre un relato y
 * devuelve el PDF resultante.
 *
 * Es la prueba de humo de todo lo jurídico —clasificar, estructurar, recuperar,
 * redactar, verificar, imprimir— sin pasar por WhatsApp ni gastar un mensaje de
 * Twilio. Sirve además para iterar la maqueta del documento y para grabar la
 * demo mostrando el PDF sin depender del sandbox.
 *
 * Con ?relato=... se prueba cualquier caso; sin parámetros usa uno de ejemplo.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);

  const relato = url.searchParams.get("relato")
    ?? "Buenas, mi nombre es María Fernanda Ríos Beltrán, cédula 52481905, vivo en Bogotá. "
      + "Tengo una lesión en la columna desde un accidente y el médico del hospital me ordenó "
      + "una silla de ruedas el 3 de junio. Radiqué la solicitud en Nueva EPS el 10 de junio y "
      + "nunca me respondieron. Fui otra vez el 24 de junio y me dijeron de palabra que eso no "
      + "está en el plan de beneficios, que no me la iban a dar. Llevo dos meses sin poder salir "
      + "de la casa, dependo de mi hermana para todo. Ya reclamé varias veces y nada.";

  const respuestas = {
    nombre: url.searchParams.get("nombre") ?? "María Fernanda Ríos Beltrán",
    cedula: url.searchParams.get("cedula") ?? "52481905",
    ciudad: url.searchParams.get("ciudad") ?? "Bogotá",
    accionado: url.searchParams.get("accionado") ?? "Nueva EPS",
    que_negaron: url.searchParams.get("que_negaron") ?? "la silla de ruedas ordenada por el médico tratante",
    correo: url.searchParams.get("correo") ?? "maria.rios.ejemplo@gmail.com",
    fecha_negacion: url.searchParams.get("fecha") ?? "24 de junio",
    diagnostico: url.searchParams.get("diagnostico") ?? "lesión en la columna",
    ya_reclamo: "sí",
    relato,
  };

  const t0 = Date.now();
  const armado = await armarTutela(relato, respuestas, url.searchParams.get("telefono") ?? "+57 300 000 0000");
  const ms = Date.now() - t0;

  if (armado.estado !== "listo") {
    return Response.json({ estado: armado.estado, motivo: armado.motivo, ms }, { status: 422 });
  }

  const citas = armado.verificacion?.fundamentos.flatMap((f) => f.citas) ?? [];
  return Response.json({
    ms,
    verHtml: `/tutela?id=${armado.tutelaId}`,
    verPdf: `/api/pdf/${armado.pdfId}.pdf`,
    hechos: armado.doc.hechos.length,
    pretensiones: armado.doc.pretensiones.length,
    fundamentos: armado.doc.fundamentos.length,
    medidaProvisional: armado.doc.medida_provisional,
    citasVerificadas: citas.map((c) => ({ sentencia: c.etiqueta, url: c.url, frase: c.frase.slice(0, 90) + "…" })),
    citasRechazadas: armado.verificacion?.rechazadas.map((r) => ({ sentencia: r.sentencia, motivo: r.motivo })) ?? [],
    reintentos: armado.verificacion?.intentos ?? 0,
    sentenciasRecuperadas: armado.sentencias.map((s) => `${s.id} (${s.resultado})`),
    estadistica: fraseEstadistica(armado.estadistica, armado.verificacion),
    guionVoz: armado.guionVoz,
  });
}

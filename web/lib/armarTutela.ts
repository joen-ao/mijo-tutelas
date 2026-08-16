/**
 * De un relato a un PDF radicable: la cadena completa, en un solo lugar.
 *
 *   clasificar → estructurar → recuperar → redactar → VERIFICAR → imprimir
 *
 * Vive aparte de computarRespuesta() para que el webhook siga siendo lo que
 * era: una máquina de turnos de conversación. Aquí está la parte jurídica.
 *
 * Degradación: cada eslabón puede fallar (Gemini caído, cuota agotada, JSON
 * inservible) y ninguno tumba el documento salvo la estructuración, que es la
 * única sin la que no hay tutela. Sin clasificación se asume salud; sin
 * redacción, el escrito sale con los fundamentos de ley y sin citas. Un PDF sin
 * jurisprudencia sigue siendo una tutela válida y radicable — el art. 14 del
 * Decreto 2591 dice expresamente que no es indispensable citar la norma
 * infringida. Uno con una cita falsa, no.
 */
import { buscarJurisprudencia, estadisticaResultados, type SentenciaRecuperada } from "@/lib/jurisprudencia";
import { guardarPdf, subirPdf } from "@/lib/pdfStore";
import { clasificar, type Clasificacion } from "@/lib/prompts/clasificar";
import { estructurar } from "@/lib/prompts/estructurar";
import { redactar } from "@/lib/prompts/redactar";
import { frasePedido, guardarTutela, type FundamentoDoc, type Tutela } from "@/lib/tutela";
import { generarTutelaPdf } from "@/lib/tutelaPdf";
import { corpusDelIndice, instruccionesDeReintento, verificarRedaccion, type Verificacion } from "@/lib/verificador";

export type Armado =
  | {
      estado: "listo";
      pdfId: string;
      /** URL pública en Supabase, si se pudo subir. Null → se sirve local. */
      pdfUrl: string | null;
      tutelaId: string;
      doc: Tutela;
      estadistica: { concedidas: number; total: number };
      verificacion: Verificacion | null;
      sentencias: SentenciaRecuperada[];
      /** Lo que se le lee en la nota de voz. */
      guionVoz: string;
    }
  | { estado: "fuera_de_alcance"; motivo: string }
  | { estado: "fallo"; motivo: string };

/* Pretensiones de respaldo si el modelo no devolvió ninguna utilizable. Son las
 * de cualquier tutela de salud, así que sirven de piso sin inventar nada del
 * caso concreto. */
function pretensionesPorDefecto(queNegaron: string, accionado: string): string[] {
  const qn = frasePedido(queNegaron) || "el servicio ordenado por el médico tratante";
  return [
    "TUTELAR los derechos fundamentales invocados en esta acción.",
    `ORDENAR a ${accionado || "la entidad accionada"} que autorice y entregue ${qn} en un término máximo de cuarenta y ocho (48) horas.`,
    "ORDENAR el tratamiento integral de la patología, incluyendo los servicios, insumos y controles que el médico tratante llegue a ordenar.",
  ];
}

/**
 * El guion de la nota de voz.
 *
 * Va por plantilla y no por LLM a propósito: se está explicando un documento
 * que ya conocemos campo por campo, así que no hay nada que interpretar, y una
 * llamada menos son varios segundos menos de espera en el punto del flujo
 * donde la persona ya lleva rato aguantando. Además nunca puede describir mal
 * lo que el PDF dice.
 */
function guionDeVoz(doc: Tutela, stats: { concedidas: number; total: number }): string {
  const partes: string[] = [];
  partes.push(
    `Listo. Ya te mandé tu acción de tutela contra ${doc.accionado.nombre || "la entidad"}, en PDF, lista para radicar.`,
  );
  partes.push(
    `El documento cuenta tu caso en ${doc.hechos.length} hechos numerados y le pide al juez que ordene entregarte ${frasePedido(doc.que_negaron) || "lo que te negaron"}.`,
  );
  if (doc.medida_provisional) {
    /* Se le dice por qué, no solo que se pidió: la persona tiene que poder
     * repetirle al juez en la ventanilla cuál es su urgencia. */
    partes.push(
      "Tu caso es urgente, así que además le pido al juez una medida provisional: "
      + "que ordene la atención de inmediato, sin esperar los diez días."
      + (doc.razon_urgencia ? ` La razón que le doy es que ${doc.razon_urgencia}.` : ""),
    );
  }
  partes.push(
    "Imprímelo, fírmalo de tu puño y letra, y llévalo a cualquier juzgado de tu ciudad. Pregunta por la oficina de reparto. Lleva dos copias: una la entregas y la otra te la devuelven sellada, esa guárdala.",
  );
  partes.push(
    "No necesitas abogado ni pagar nada. El juez tiene diez días hábiles para responderte.",
  );
  if (stats.total > 0) {
    partes.push(
      `En la segunda hoja del PDF te dejé todo esto explicado paso a paso, por si se te olvida.`,
    );
  }
  return partes.join(" ");
}

/** Convierte los fundamentos verificados a lo que el PDF sabe pintar. */
function fundamentosParaDoc(v: Verificacion | null): FundamentoDoc[] {
  if (!v) return [];
  return v.fundamentos.map((f) => ({ texto: f.texto, citas: f.citas }));
}

/* Sin LLM no hay redacción, pero la ley sigue estando. Este es el fundamento
 * mínimo que hace el documento radicable igual. */
function fundamentoDeLey(derecho: string): FundamentoDoc[] {
  return [
    {
      texto:
        "El artículo 86 de la Constitución Política consagra la acción de tutela como mecanismo para reclamar la protección inmediata de los derechos constitucionales fundamentales. "
        + `La Ley Estatutaria 1751 de 2015 reconoció la salud como derecho fundamental autónomo, de manera que la protección del derecho a ${derecho} no depende de acreditar su conexidad con ningún otro derecho.`,
      citas: [],
    },
    {
      texto:
        "El artículo 10 del Decreto 2591 de 1991 establece que no es necesario actuar por medio de apoderado, y el artículo 14 que no es indispensable citar la norma constitucional infringida. "
        + "La negativa de la entidad accionada a autorizar el servicio ordenado por el médico tratante desconoce el derecho invocado y hace procedente el amparo.",
      citas: [],
    },
  ];
}

/**
 * Arma la tutela completa.
 *
 * `relato` es todo lo que la persona contó (texto o nota de voz transcrita).
 * `respuestas` son los campos ya confirmados en la conversación, que mandan
 * sobre lo que el modelo crea leer en el relato.
 */
export async function armarTutela(
  relato: string,
  respuestas: Record<string, unknown>,
  /** Teléfono de WhatsApp: va en NOTIFICACIONES, el juzgado notifica por ahí. */
  telefono = "",
): Promise<Armado> {
  const str = (k: string) => String(respuestas[k] ?? "").trim();

  /* 1. Clasificar. Si falla, se sigue asumiendo salud: el flujo entero ya está
   *    acotado a negativas de EPS, así que es el supuesto correcto. */
  let clas: Clasificacion | null = null;
  try {
    clas = await clasificar(relato);
  } catch (e) {
    console.error("[armar-tutela] clasificar", e);
  }
  if (clas && !clas.es_tutelable) {
    return { estado: "fuera_de_alcance", motivo: clas.motivo || "el caso no es de salud" };
  }
  const derecho = clas?.derecho_fundamental ?? "salud";

  /* 2. Estructurar. Es el único paso sin el que no hay documento. */
  const estructura = await estructurar(relato, respuestas).catch((e) => {
    console.error("[armar-tutela] estructurar", e);
    return null;
  });
  if (!estructura) return { estado: "fallo", motivo: "no se pudo estructurar el relato en hechos" };

  /* 3. Recuperar jurisprudencia por el SUPUESTO DE HECHO, no por la pregunta
   *    jurídica: el índice semántico compara caso contra caso. */
  const consulta = [str("que_negaron"), str("diagnostico"), relato].filter(Boolean).join(". ");
  const sentencias = await buscarJurisprudencia(consulta, 5).catch(() => [] as SentenciaRecuperada[]);
  const estadistica = estadisticaResultados(sentencias);

  /* 4 y 5. Redactar y VERIFICAR. La verificación no es opcional: nada que no
   *        pase por aquí llega al PDF. */
  const hechosTexto = estructura.hechos.map((h) => `${h.numero}. ${h.texto}${h.fecha ? ` (${h.fecha})` : ""}`).join("\n");

  let verificacion: Verificacion | null = null;
  const borrador = await redactar(hechosTexto, derecho, sentencias).catch(() => null);
  if (borrador) {
    const corpus = await corpusDelIndice();
    verificacion = await verificarRedaccion(borrador, corpus, async (rechazadas) =>
      redactar(hechosTexto, derecho, sentencias, instruccionesDeReintento(rechazadas)).catch(() => null),
    );
  }

  const fundamentos = verificacion ? fundamentosParaDoc(verificacion) : fundamentoDeLey(derecho);

  /* 6. El documento y su PDF. */
  const doc: Tutela = {
    accionante: {
      nombre: estructura.accionante.nombre || str("nombre"),
      cedula: estructura.accionante.cedula || str("cedula"),
      ciudad: estructura.accionante.ciudad || str("ciudad"),
      telefono,
      correo: str("correo").includes("@") ? str("correo") : "",
    },
    accionado: {
      nombre: estructura.accionado.nombre || str("accionado"),
      tipo: clas?.tipo_accionado ?? estructura.accionado.tipo ?? "EPS",
    },
    hechos: estructura.hechos,
    derechos_vulnerados: verificacion?.derechos_vulnerados.length
      ? verificacion.derechos_vulnerados
      : [derecho],
    pretensiones: estructura.pretensiones.length
      ? estructura.pretensiones
      : pretensionesPorDefecto(str("que_negaron"), estructura.accionado.nombre || str("accionado")),
    fundamentos,
    medida_provisional: clas?.requiere_medida_provisional ?? false,
    razon_urgencia: clas?.razon_urgencia ?? null,
    que_negaron: str("que_negaron"),
    diagnostico: str("diagnostico") || null,
    fecha: new Date().toISOString(),
  };

  const tutelaId = guardarTutela(doc);
  const pdf = await generarTutelaPdf(tutelaId);
  if (!pdf) return { estado: "fallo", motivo: "no se pudo imprimir el PDF" };

  /* Se guarda SIEMPRE en memoria aunque la subida funcione: el respaldo local
   * es lo que responde si Supabase se cae entre que se sube y Twilio descarga. */
  return {
    estado: "listo",
    pdfId: guardarPdf(pdf),
    pdfUrl: await subirPdf(pdf),
    tutelaId,
    doc,
    estadistica,
    verificacion,
    sentencias,
    guionVoz: guionDeVoz(doc, estadistica),
  };
}

/** El texto de la estadística, tal como se le manda a la persona. */
export function fraseEstadistica(
  stats: { concedidas: number; total: number },
  verificacion: Verificacion | null,
): string {
  const lineas: string[] = [];
  if (stats.total > 0) {
    lineas.push(
      `📊 En sentencias parecidas a tu caso, la Corte Constitucional concedió el amparo en *${stats.concedidas} de ${stats.total}*.`,
    );
  }
  /* Se cuentan SENTENCIAS distintas, no citas: una misma sentencia puede
   * sostener tres fundamentos, y decir "cita 6 sentencias" cuando son 2 sería
   * inflar el documento delante de la persona. */
  const citas = verificacion?.fundamentos.flatMap((f) => f.citas) ?? [];
  const distintas = [...new Map(citas.map((c) => [c.sentencia, c.etiqueta])).values()];
  if (distintas.length) {
    lineas.push(
      `Tu tutela se apoya en ${distintas.length === 1 ? "1 sentencia" : `${distintas.length} sentencias`} de la Corte `
      + `(${distintas.join(", ")}), con ${citas.length === 1 ? "1 cita textual" : `${citas.length} citas textuales`}. `
      + "Cada una la comprobamos contra el texto oficial antes de ponerla.",
    );
  }
  lineas.push("Esto no es una predicción de tu caso: es lo que la Corte ya decidió en casos con hechos parecidos.");
  return lineas.join("\n\n");
}

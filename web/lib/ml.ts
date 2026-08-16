/**
 * El cerebro: motor de reglas de PROCEDENCIA de la acción de tutela.
 *
 * Antes esto era el cliente HTTP de un microservicio Python con LightGBM. Ahora
 * corre aquí mismo, en TypeScript, y no hay nada entrenado. La superficie
 * pública es la misma a propósito —perfilar, score, getHealth y sus tipos— para
 * que lib/flow.ts y el webhook de WhatsApp no se enteren del cambio.
 *
 * POR QUÉ REGLAS Y NO UN MODELO. La procedencia de una tutela no es una
 * predicción: es una lista de requisitos que la Constitución y el Decreto 2591
 * de 1991 fijan por escrito. Un modelo aprendido daría una probabilidad que
 * nadie puede auditar y que, en un producto jurídico, sería peor que inútil:
 * sería irresponsable. Un motor de reglas dice exactamente qué requisito falta
 * y en qué norma está, y eso se puede discutir con un juez.
 *
 * Por eso `explicacion_shap` ya no trae valores SHAP sino la lista de reglas
 * evaluadas con su fundamento normativo. Se conservó el nombre del campo
 * porque lo leen archivos que este proyecto no toca.
 */

type Json = Record<string, unknown>;

export interface Health {
  status: string;
  model_version: string;
  recommender_version: string;
}

/** Ya no hay servicio remoto que consultar: el cerebro vive en este proceso. */
export function getHealth(): Promise<Health> {
  return Promise.resolve({
    status: "ok",
    model_version: "reglas-procedencia-tutela-1.0",
    recommender_version: "jurisprudencia-bm25+embeddings-1.0",
  });
}

/* ── Las reglas ──────────────────────────────────────────────────────────── */

export type Ruteo = "procedente" | "falta_informacion" | "no_es_via_de_tutela";

export interface Regla {
  clave: string;
  pregunta: string;
  cumple: boolean;
  /** La norma o el criterio del que sale el requisito. */
  fundamento: string;
  /** Si falla, no hay tutela que redactar. */
  critica: boolean;
  /** Qué se vio en el relato para decidir. */
  evidencia: string | null;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** "sí", true, "ya llamé" → true. "no", "todavía no" → false. Vacío → null.
 *
 * Se aceptan "true"/"false" como texto porque el modelo devuelve el booleano
 * de JSON aunque el prompt le pida "sí"/"no", y al pasar por String() llegan
 * aquí como cadena. Sin esto la conversación se queda en bucle preguntando lo
 * mismo, que es justo donde alguien enfermo abandona. */
function tresEstados(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const t = texto(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!t) return null;
  if (/^(false|no|nunca|todavia no|aun no|nada)\b/.test(t)) return false;
  if (/^(true|si|ya|claro)\b/.test(t)) return true;
  if (/\b(si|ya|claro|reclam|llam[eé]|puse|radiqu|peticion|insist|fui|he ido)\b/.test(t)) return true;
  return null;
}

/* Una fecha aunque sea aproximada: "12 de marzo", "marzo", "hace dos semanas".
 * No se exige formato: la persona está contando lo que le pasó, no llenando un
 * formulario, y el Decreto 2591 art. 14 dice que la tutela puede ser verbal.
 *
 * Cubre también el caso más común de todos: la negativa POR OMISIÓN. Cuando la
 * EPS no contesta —"llevo cinco meses esperando"— no hay fecha de negativa que
 * dar, y el hecho vulnerador es la espera misma. Ahí la fecha que ancla la
 * inmediatez es desde cuándo espera, no un "no" que nunca llegó. */
const RE_FECHA = /\b(\d{1,2}\s*(de|\/|-)\s*\w+|\d{1,2}\/\d{1,2}\/\d{2,4}|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|ayer|anteayer|hace\s+\w+\s*(d[ií]as?|semanas?|meses?|a[nñ]os?)|la semana pasada|el mes pasado)\b/i;

export function evaluarReglas(perfil: Json): Regla[] {
  const derecho = texto(perfil.derecho_fundamental);
  const queNegaron = texto(perfil.que_negaron);
  const fecha = texto(perfil.fecha_negacion);
  const accionado = texto(perfil.accionado);
  const yaReclamo = tresEstados(perfil.ya_reclamo);
  const otroMecanismo = perfil.otro_mecanismo_idoneo === true;
  const urgencia = texto(perfil.urgencia).toLowerCase();

  return [
    {
      clave: "derecho_fundamental",
      pregunta: "¿Hay un derecho fundamental identificado?",
      cumple: Boolean(derecho) || Boolean(queNegaron),
      fundamento: "Art. 86 C.P. — la tutela protege derechos constitucionales fundamentales. La salud lo es (Ley 1751 de 2015).",
      critica: true,
      evidencia: derecho || queNegaron || null,
    },
    {
      clave: "hecho_vulnerador",
      pregunta: "¿Hay un hecho vulnerador con fecha?",
      cumple: Boolean(queNegaron) && (Boolean(fecha) && RE_FECHA.test(fecha)),
      fundamento: "Art. 86 C.P. y principio de inmediatez — hay que poder situar en el tiempo la acción u omisión que vulnera.",
      critica: true,
      evidencia: queNegaron ? `${queNegaron}${fecha ? ` (${fecha})` : " — sin fecha"}` : null,
    },
    {
      clave: "accionado",
      pregunta: "¿Está identificado el accionado?",
      cumple: Boolean(accionado),
      fundamento: "Art. 13 y 14 Decreto 2591 de 1991 — hay que decir contra quién se dirige la acción.",
      critica: true,
      evidencia: accionado || null,
    },
    {
      clave: "reclamo_previo",
      pregunta: "¿La persona ya reclamó directamente?",
      cumple: yaReclamo === true,
      /* No es requisito de procedencia y por eso no es crítica: exigirlo sería
       * inventar una barrera que la ley no puso. Pero probar que se pidió y no
       * se obtuvo respuesta hace la vulneración mucho más difícil de negar. */
      fundamento: "No es requisito legal (art. 10 Decreto 2591: no se necesita abogado ni trámite previo). Suma como prueba de la omisión.",
      critica: false,
      evidencia: yaReclamo === null ? null : yaReclamo ? "ya reclamó ante la entidad" : "no ha reclamado directamente",
    },
    {
      clave: "subsidiariedad",
      pregunta: "¿Existe otro mecanismo judicial idóneo?",
      /* Se cumple cuando NO lo hay, que es el caso normal en salud: la Corte ha
       * dicho que el trámite ante la Superintendencia Nacional de Salud no es
       * eficaz —no falla en los 10 días y no llega a todo el país—, de modo que
       * la tutela sigue siendo la vía. Solo se marca lo contrario si el
       * clasificador detectó un asunto que no es de salud. */
      cumple: !otroMecanismo || /alta|inminente|vida/.test(urgencia),
      fundamento: "Art. 86 C.P. y art. 6 Decreto 2591 — la tutela es subsidiaria, salvo que el otro medio no sea eficaz o haya perjuicio irremediable.",
      critica: true,
      evidencia: otroMecanismo ? "el clasificador detectó otra vía idónea" : "no hay otro mecanismo eficaz para lo pedido",
    },
  ];
}

export interface ScoreResult {
  score: number;
  probabilidad: number;
  riesgo_desistimiento: number;
  ruteo: Ruteo;
  explicacion_shap: unknown[];
  capacidad: unknown;
}

/**
 * Puntúa la procedencia de una tutela a partir del relato ya estructurado.
 *
 * `probabilidad` es la fracción de requisitos de PROCEDENCIA que se cumplen.
 * NO es la probabilidad de ganar: eso depende del juez y del caso, y ningún
 * dato de este proyecto autoriza a estimarlo. La cifra que sí se le muestra a
 * la persona es la de sentencias análogas concedidas, que es un hecho contado
 * del corpus y no una predicción (ver lib/jurisprudencia.ts).
 */
export function score(perfil: Json): Promise<ScoreResult> {
  const reglas = evaluarReglas(perfil);
  const criticas = reglas.filter((r) => r.critica);
  const cumplidas = criticas.filter((r) => r.cumple);
  const subsidiariedad = reglas.find((r) => r.clave === "subsidiariedad")!;

  const ruteo: Ruteo = !subsidiariedad.cumple
    ? "no_es_via_de_tutela"
    : cumplidas.length === criticas.length
      ? "procedente"
      : "falta_informacion";

  const proporcion = criticas.length ? cumplidas.length / criticas.length : 0;
  const bonoNoCritica = reglas.some((r) => !r.critica && r.cumple) ? 5 : 0;

  return Promise.resolve({
    score: Math.round(proporcion * 95) + bonoNoCritica,
    probabilidad: Number(proporcion.toFixed(2)),
    // Cuántos datos faltan todavía: es lo que hace que alguien abandone el chat.
    riesgo_desistimiento: Number((1 - proporcion).toFixed(2)),
    ruteo,
    explicacion_shap: reglas,
    capacidad: {
      requisitos_cumplidos: cumplidas.length,
      requisitos_totales: criticas.length,
      faltantes: criticas.filter((r) => !r.cumple).map((r) => r.clave),
    },
  });
}

/* ── Qué preguntar ahora ─────────────────────────────────────────────────── */

interface Campo { clave: string; texto: string; obligatorio: boolean }

/* El orden importa: primero lo que duele (qué le negaron), después los datos
 * de trámite. Preguntar la cédula de entrada espanta a cualquiera. */
const CAMPOS: Campo[] = [
  { clave: "que_negaron", texto: "¿Qué fue lo que te negó la EPS? Cuéntame con tus palabras.", obligatorio: true },
  { clave: "accionado", texto: "¿Cuál es tu EPS?", obligatorio: true },
  { clave: "fecha_negacion", texto: "¿Cuándo te lo negaron? Y si nunca te respondieron, dime desde cuándo llevas esperando. Con una fecha aproximada basta.", obligatorio: true },
  { clave: "diagnostico", texto: "¿Qué diagnóstico o enfermedad tienes? Si tienes la orden médica a la mano, mejor.", obligatorio: false },
  { clave: "ya_reclamo", texto: "¿Ya reclamaste directamente en la EPS?", obligatorio: true },
  { clave: "ciudad", texto: "¿En qué ciudad vives? Es para saber ante qué juez se radica.", obligatorio: true },
  { clave: "nombre", texto: "¿Cuál es tu nombre completo, como aparece en la cédula?", obligatorio: true },
  { clave: "cedula", texto: "¿Cuál es tu número de cédula?", obligatorio: true },
  { clave: "correo", texto: "¿A qué correo te mando la tutela? Si no tienes, dime \"no tengo\" y te la dejo solo por aquí.", obligatorio: true },
];

function falta(respuestas: Json, campo: Campo): boolean {
  const v = respuestas[campo.clave];
  if (campo.clave === "ya_reclamo") return tresEstados(v) === null;
  /* El correo se da por resuelto con una dirección válida O con un "no tengo".
   * No tener correo no puede dejar a nadie sin tutela: el PDF ya le llegó por
   * WhatsApp, y el correo es un canal de más. */
  if (campo.clave === "correo") {
    const t = texto(v).toLowerCase();
    return !(t.includes("@") || /^(no|ninguno|sin correo)/.test(t));
  }
  return !texto(v);
}

/**
 * Decide qué falta preguntar, o cierra el perfilamiento.
 *
 * Devuelve el mismo sobre que devolvía el microservicio —status y
 * next_question{campo,texto}— porque así lo leen lib/flow.ts y el webhook.
 */
export function perfilar(payload: Json): Promise<Json> {
  const respuestas = (payload.respuestas as Json) ?? {};
  const pendientes = CAMPOS.filter((c) => c.obligatorio && falta(respuestas, c));

  if (pendientes.length) {
    const siguiente = pendientes[0];
    return Promise.resolve({
      status: "asking",
      next_question: { campo: siguiente.clave, texto: siguiente.texto },
      faltantes: pendientes.map((c) => c.clave),
    });
  }

  return score(respuestas).then((s) => ({
    status: "qualified",
    ...s,
    destino: s.ruteo === "procedente" ? "radicar"
      : s.ruteo === "no_es_via_de_tutela" ? "no_procede"
      : "falta_informacion",
    // El sobre traía estos dos y flow.ts los persiste; en amparo van vacíos.
    beneficios_revelados: [],
    proyectos_recomendados: [],
  }));
}


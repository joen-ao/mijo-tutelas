/**
 * TRIAJE — antes de clasificar el caso, decidir POR QUÉ VÍA se reclama.
 *
 * Va antes de prompts/clasificar.ts en el orden lógico: clasificar responde
 * "¿qué derecho está en juego?" dando por hecho que vamos a tutela. Triaje
 * responde la pregunta anterior, la que nadie le hace a la persona: si todavía
 * no le ha pedido NADA por escrito a la EPS, la tutela puede no ser lo primero.
 *
 * Por qué importa y no es un tecnicismo: un derecho de petición se responde en
 * 15 días hábiles, no cuesta nada, no necesita juez y muchísimas negativas de
 * EPS se caen ahí mismo cuando la entidad tiene que responder por escrito. Y
 * cuando NO se cae, la respuesta (o el silencio) queda como prueba documental
 * de la negativa — que es justo lo que a las tutelas armadas de oídas les falta.
 * Mandar a todo el mundo directo a tutela satura juzgados y, peor, le hace
 * perder a la persona la prueba que le habría servido.
 *
 * El límite de esa lógica es la urgencia médica, y ahí no se negocia: si hay
 * riesgo vital, esperar 15 días hábiles a una EPS es exactamente el daño que la
 * tutela existe para evitar. Por eso la urgencia la mira TAMBIÉN el código, más
 * abajo, y pisa lo que diga el modelo.
 *
 * El esquema se pide por prompt y se valida aquí, porque lib/llm.ts expone
 * `generarJSON` sin responseSchema y ese archivo no se toca.
 */
import { generarJSON } from "@/lib/llm";

/** Las tres modalidades con término propio en el art. 14 de la Ley 1755. */
export type TipoPeticion = "general" | "documentos_informacion" | "consulta";

export type Via = "derecho_peticion" | "tutela" | "peticion_luego_tutela";

export interface Triaje {
  /** ¿Ya le pidió algo FORMALMENTE a la entidad (radicado, PQR, carta)? */
  ya_reclamo_directamente: boolean;
  via_recomendada: Via;
  /** Qué modalidad de petición sería, si la vía incluye petición. */
  tipo_peticion: TipoPeticion;
  /** Por qué el modelo decidió así. No va al PDF; sirve para auditar el eval. */
  motivo: string;
  /** true si el código forzó tutela por urgencia vital, ignorando al modelo. */
  urgencia_forzo_tutela: boolean;
}

const ESQUEMA = `{
  "ya_reclamo_directamente": true | false,
  "via_recomendada": "derecho_peticion" | "tutela" | "peticion_luego_tutela",
  "tipo_peticion": "general" | "documentos_informacion" | "consulta",
  "motivo": "una frase"
}`;

export function promptTriaje(relato: string): string {
  return `Eres un abogado colombiano decidiendo POR QUÉ VÍA debe reclamar una persona
frente a su EPS: derecho de petición (Ley 1755 de 2015) o acción de tutela.

RELATO DE LA PERSONA:
"""
${relato}
"""

Decide:

1. ya_reclamo_directamente: true SOLO si la persona ya le pidió algo FORMALMENTE a
   la entidad: radicó una solicitud, una PQR, una carta, un derecho de petición, o
   dejó constancia escrita. Ir a la sede y que le digan de palabra que no, llamar a
   la línea, o "reclamar" en el sentido de quejarse, NO es haber reclamado
   formalmente → false. Si no queda claro, false.

2. via_recomendada:
   - "derecho_peticion": no ha pedido nada formalmente, no hay riesgo para la vida
     y lo que necesita es que la entidad se pronuncie por escrito. Es la vía por
     defecto en este supuesto: es gratis, la entidad tiene 15 días hábiles y suele
     resolver sin juez.
   - "peticion_luego_tutela": no ha pedido nada formalmente, pero el caso ya se ve
     encaminado a tutela (negativa reiterada de palabra, patología en curso,
     persona de especial protección). Se radica la petición ahora para dejar la
     negativa por escrito y con eso se tutelará si no responden.
   - "tutela": ya reclamó formalmente y le negaron o guardaron silencio, O hay
     urgencia médica. La tutela no exige agotar el derecho de petición: nunca la
     descartes por el solo hecho de que la persona no haya pedido nada antes.

3. URGENCIA — esta regla vence a todas las anteriores. Si hay riesgo inminente para
   la vida o la integridad, via_recomendada es "tutela", sin importar si reclamó o
   no antes. Cuentan como urgencia, entre otros: quimioterapia o radioterapia,
   diálisis, oxígeno domiciliario, medicamento vital suspendido o en curso que se
   interrumpe, UCI, cirugía urgente, riesgo de perder un órgano o la visión,
   embarazo de alto riesgo, y cualquier tratamiento activo que se cortó.

4. tipo_peticion: qué modalidad sería la petición.
   - "documentos_informacion": pide copias, historia clínica, el soporte escrito de
     una negativa, o información que la entidad ya tiene.
   - "consulta": pregunta por el criterio o la interpretación de la entidad.
   - "general": todo lo demás — que autoricen, entreguen, agenden o presten algo.
     Es el caso normal en salud.

Responde SOLO este JSON, sin texto alrededor:
${ESQUEMA}`;
}

/* ── El freno de mano del código ─────────────────────────────────────────── */

/**
 * Señales de urgencia vital buscadas sobre el TEXTO del relato.
 *
 * No sustituyen el juicio del modelo: lo acotan por un lado solo. Si el modelo
 * dice "tutela", esto no puede bajarlo a petición; si el modelo dice "petición"
 * y el relato menciona diálisis, esto lo sube a tutela.
 *
 * La asimetría es deliberada porque los dos errores no cuestan lo mismo. Mandar
 * a tutela a alguien que habría resuelto con una petición le cuesta un trámite
 * de más. Mandar a esperar 15 días hábiles a alguien en diálisis puede costarle
 * mucho más que eso, y ninguna de las dos cosas es reversible por igual.
 */
const SENALES_VITALES = [
  "quimioterapia", "quimio", "radioterapia", "dialisis", "hemodialisis",
  "oxigeno", "trasplante", "uci", "cuidados intensivos", "cancer",
  "insulina", "anticoagulante", "inmunosupresor", "antirretroviral",
  "marcapasos", "sonda", "traqueostomia", "paliativo",
];

/* Un medicamento vital NO es urgente por nombrarse, sino por estar cortado. La
 * urgencia aparece cuando el tratamiento que ya venía se interrumpe. */
const SENALES_INTERRUPCION = [
  "suspend", "interrump", "corta", "corto", "cortaron", "dejaron de",
  "sin el medicamento", "se me acabo", "no me lo han vuelto", "vencio la autorizacion",
];

function normalizar(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * ¿El relato menciona algo que no admite esperar 15 días hábiles?
 *
 * Exportada para que el eval la pueda probar sola, sin gastar una llamada al
 * modelo: es una regla, y las reglas se prueban.
 */
export function hayUrgenciaVital(relato: string): boolean {
  const r = normalizar(relato);
  if (SENALES_VITALES.some((s) => r.includes(s))) return true;
  /* "medicamento" + "suspendido" en el mismo relato: el nombre del fármaco puede
   * ser cualquiera y no lo vamos a listar, pero la interrupción sí es buscable. */
  const hayTratamiento = /medicament|tratamiento|terapia|droga|formula/.test(r);
  return hayTratamiento && SENALES_INTERRUPCION.some((s) => r.includes(s));
}

/* ── Los plazos: los pone el código, no el modelo ────────────────────────── */

/**
 * Días HÁBILES que tiene la entidad para resolver, según la modalidad.
 *
 * Ley 1755 de 2015, artículo 14 (que sustituyó el art. 14 de la Ley 1437 de
 * 2011), verificado contra el Gestor Normativo de la Función Pública:
 *
 *   - Regla general: «toda petición deberá resolverse dentro de los quince (15)
 *     días siguientes a su recepción».
 *   - Numeral 1: «Las peticiones de documentos y de información deberán
 *     resolverse dentro de los diez (10) días siguientes a su recepción». Si no
 *     responden en ese lapso la solicitud SE ENTIENDE ACEPTADA para todos los
 *     efectos legales, y las copias se entregan dentro de los tres (3) días
 *     siguientes.
 *   - Numeral 2: «Las peticiones mediante las cuales se eleva una consulta a las
 *     autoridades en relación con las materias a su cargo deberán resolverse
 *     dentro de los treinta (30) días siguientes a su recepción».
 *
 * El artículo dice "días" a secas. Se cuentan HÁBILES por el art. 62 de la Ley 4
 * de 1913 (Código de Régimen Político y Municipal): en los plazos de días que
 * señalen las leyes «se entienden suprimidos los feriados y de vacantes, a menos
 * de expresarse lo contrario», y el art. 14 no expresa lo contrario.
 *
 * Que esto sea una función y no un campo del JSON del modelo es la regla de oro
 * del proyecto: el plazo es un hecho legal fijo. Preguntárselo a un modelo es
 * aceptar que un día devuelva 30 donde la ley dice 10, y ese error se paga con
 * un derecho vencido.
 */
export function plazoPeticion(tipo: TipoPeticion): number {
  switch (tipo) {
    case "documentos_informacion": return 10; // art. 14, num. 1
    case "consulta": return 30;               // art. 14, num. 2
    case "general": return 15;                // art. 14, inciso 1
  }
}

/**
 * El plazo máximo de la prórroga excepcional del parágrafo del art. 14: la
 * entidad puede ampliarlo, pero avisando ANTES del vencimiento y «que no podrá
 * exceder del doble del inicialmente previsto». Se le dice a la persona para que
 * sepa distinguir una prórroga legítima de una excusa.
 */
export function plazoMaximoConProrroga(tipo: TipoPeticion): number {
  return plazoPeticion(tipo) * 2;
}

/* ── La llamada ──────────────────────────────────────────────────────────── */

const VIAS: Via[] = ["derecho_peticion", "tutela", "peticion_luego_tutela"];
const TIPOS: TipoPeticion[] = ["general", "documentos_informacion", "consulta"];

/**
 * Tría el relato. Devuelve null si no hay LLM o si la respuesta no cumple el
 * esquema — quien llama decide qué hacer, igual que en clasificar(). Seguir con
 * un triaje inventado sería mandar a alguien por la vía equivocada.
 *
 * Cuando SÍ devuelve algo, la urgencia ya viene aplicada: quien llama no tiene
 * que acordarse de revisarla.
 */
export async function triar(relato: string): Promise<Triaje | null> {
  const r = await generarJSON<Record<string, unknown>>(promptTriaje(relato));
  if (!r) return null;

  const via = String(r.via_recomendada ?? "").toLowerCase().trim() as Via;
  const tipo = String(r.tipo_peticion ?? "").toLowerCase().trim() as TipoPeticion;

  if (typeof r.ya_reclamo_directamente !== "boolean") return null;

  const viaModelo: Via = VIAS.includes(via) ? via : "tutela";
  const urgente = hayUrgenciaVital(relato);
  /* Solo sube, nunca baja: ver el comentario de SENALES_VITALES. */
  const forzada = urgente && viaModelo !== "tutela";

  if (forzada) {
    console.warn(
      `[triaje] el modelo propuso "${viaModelo}" pero el relato tiene señales de urgencia vital; `
      + "se fuerza tutela.",
    );
  }

  return {
    ya_reclamo_directamente: r.ya_reclamo_directamente,
    via_recomendada: forzada ? "tutela" : viaModelo,
    tipo_peticion: TIPOS.includes(tipo) ? tipo : "general",
    motivo: forzada
      ? "Hay un tratamiento vital de por medio: esperar el término de una petición no es opción."
      : String(r.motivo ?? "").slice(0, 300),
    urgencia_forzo_tutela: forzada,
  };
}

/**
 * Triaje sin modelo, para cuando Gemini no está o devolvió basura.
 *
 * Cae del lado de la TUTELA a propósito. Es el comportamiento que Mijo ya tenía
 * antes de este archivo, así que degradar hacia allá no rompe nada; y si nos
 * vamos a equivocar sin información, que sea por el lado que no deja a nadie
 * esperando 15 días hábiles.
 */
export function triajePorDefecto(relato: string): Triaje {
  return {
    ya_reclamo_directamente: false,
    via_recomendada: "tutela",
    tipo_peticion: "general",
    motivo: hayUrgenciaVital(relato)
      ? "Hay señales de urgencia vital en el relato."
      : "No se pudo triar el caso; se sigue por la vía de la tutela.",
    urgencia_forzo_tutela: hayUrgenciaVital(relato),
  };
}

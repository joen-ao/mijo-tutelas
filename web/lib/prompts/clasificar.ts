/**
 * Prompt 1 de 3 — CLASIFICAR: qué derecho está en juego y con qué urgencia.
 *
 * Es el primer juicio del modelo y el que decide si seguimos: si el caso no es
 * de salud, Mijo no lo atiende y hay que decirlo, no improvisar una tutela de
 * otra materia. El alcance del MVP es EPS que niega medicamento, procedimiento,
 * cita o tratamiento; todo lo demás sale por `es_tutelable: false`.
 *
 * El esquema se pide por prompt y se valida aquí, porque lib/llm.ts expone
 * `generarJSON` sin responseSchema y ese archivo no se toca.
 */
import { generarJSON } from "@/lib/llm";

export type Urgencia = "alta" | "media" | "baja";

export interface Clasificacion {
  /** El derecho fundamental principal invocado, en los términos de la C.P. */
  derecho_fundamental: string;
  /** ¿Cae dentro del alcance de Mijo (salud contra una EPS/entidad de salud)? */
  es_tutelable: boolean;
  tipo_accionado: "EPS" | "IPS" | "medicina_prepagada" | "entidad_publica" | "otro";
  urgencia: Urgencia;
  /** Riesgo de daño irreparable mientras el juez decide (art. 7 Decreto 2591). */
  requiere_medida_provisional: boolean;
  /**
   * POR QUÉ es urgente, en los términos del caso ("está en quimioterapia y el
   * tratamiento lleva seis semanas interrumpido"). Va al PDF: un juez no
   * concede una medida provisional porque se la pidan, sino porque la petición
   * dice qué daño concreto ocurre si espera. Null si no aplica.
   */
  razon_urgencia: string | null;
  /** Por qué el modelo decidió así. No va al PDF; sirve para auditar el eval. */
  motivo: string;
}

const ESQUEMA = `{
  "derecho_fundamental": "salud" | "vida" | "vida digna" | "seguridad social" | "integridad personal" | "mínimo vital" | "diagnóstico",
  "es_tutelable": true | false,
  "tipo_accionado": "EPS" | "IPS" | "medicina_prepagada" | "entidad_publica" | "otro",
  "urgencia": "alta" | "media" | "baja",
  "requiere_medida_provisional": true | false,
  "razon_urgencia": "una frase concreta, o null",
  "motivo": "una frase"
}`;

export function promptClasificar(relato: string): string {
  return `Eres un abogado constitucionalista colombiano clasificando un caso para una acción de tutela.

RELATO DE LA PERSONA:
"""
${relato}
"""

Clasifícalo:

1. derecho_fundamental: el derecho principal vulnerado. En negativas de servicios de
   salud casi siempre es "salud" (fundamental autónomo desde la Ley 1751 de 2015; ya
   no hay que argumentar conexidad con la vida). Usa "vida" solo si hay riesgo vital
   inmediato, y "mínimo vital" si lo negado compromete la subsistencia económica.

2. es_tutelable: true SOLO si es una negativa, demora u obstáculo de una entidad del
   sistema de salud (EPS, IPS, prepagada) frente a un servicio, medicamento,
   procedimiento, cita, tratamiento, insumo o transporte. Si el relato es de pensiones,
   laboral, arriendo, servicios públicos, educación o cualquier otra materia →
   es_tutelable: false. No fuerces el caso para que quepa.

3. tipo_accionado: qué clase de entidad es la accionada.

4. urgencia:
   - "alta": hay riesgo para la vida o la integridad, enfermedad grave o degenerativa,
     cáncer, diálisis, persona de especial protección (menor, adulto mayor, gestante,
     persona con discapacidad), o el tratamiento está interrumpido.
   - "media": afecta la salud pero admite espera sin daño irreversible.
   - "baja": trámite o inconformidad sin afectación clínica clara.

5. requiere_medida_provisional: true si esperar los 10 días del fallo puede causar un
   daño irreparable (art. 7 del Decreto 2591 de 1991). Marca true si aparece
   CUALQUIERA de estos:
   - tratamiento oncológico (quimioterapia, radioterapia, cirugía de cáncer)
   - diálisis o enfermedad renal crónica
   - oxígeno domiciliario o soporte respiratorio
   - un medicamento vital suspendido o interrumpido
   - riesgo de muerte, de daño irreversible o de perder una función (vista,
     movilidad, un miembro)
   - la persona es menor de edad, adulto mayor, gestante o tiene discapacidad
   - hospitalización en curso o alta que depende del servicio negado
   Ante la duda, true: el costo de pedirla y que el juez no la conceda es cero;
   el de no pedirla cuando hacía falta lo paga la persona con su salud.

6. razon_urgencia: si requiere_medida_provisional es true, UNA FRASE que diga qué daño
   concreto ocurre si la persona espera, con los datos del relato ("tiene 74 años,
   depende de oxígeno permanente y lleva dos meses sin el concentrador"). Esta frase
   se lee en el documento que va al juez, así que tiene que ser específica de ESTE
   caso, no una generalidad. Si es false, null.

Responde SOLO este JSON, sin texto alrededor:
${ESQUEMA}`;
}

const DERECHOS = ["salud", "vida", "vida digna", "seguridad social", "integridad personal", "mínimo vital", "diagnóstico"];
const TIPOS = ["EPS", "IPS", "medicina_prepagada", "entidad_publica", "otro"];
const URGENCIAS: Urgencia[] = ["alta", "media", "baja"];

/**
 * Clasifica el relato. Devuelve null si no hay LLM o si la respuesta no cumple
 * el esquema — quien llama decide qué hacer, porque seguir con una
 * clasificación inventada sería peor que no tenerla.
 */
export async function clasificar(relato: string): Promise<Clasificacion | null> {
  const r = await generarJSON<Record<string, unknown>>(promptClasificar(relato));
  if (!r) return null;

  const derecho = String(r.derecho_fundamental ?? "").toLowerCase().trim();
  const tipo = String(r.tipo_accionado ?? "").trim();
  const urgencia = String(r.urgencia ?? "").toLowerCase().trim() as Urgencia;

  if (typeof r.es_tutelable !== "boolean") return null;

  const provisional = r.requiere_medida_provisional === true;
  const razon = String(r.razon_urgencia ?? "").trim();

  return {
    derecho_fundamental: DERECHOS.includes(derecho) ? derecho : "salud",
    es_tutelable: r.es_tutelable,
    tipo_accionado: (TIPOS.includes(tipo) ? tipo : "EPS") as Clasificacion["tipo_accionado"],
    urgencia: URGENCIAS.includes(urgencia) ? urgencia : "media",
    requiere_medida_provisional: provisional,
    /* Sin razón concreta no hay medida que pedir: una solicitud genérica es la
     * que el juez niega. Si el modelo marcó urgencia pero no supo decir por qué,
     * el campo queda null y la plantilla usa el texto general. */
    /* Sin el punto final: la plantilla la incrusta en mitad de una oración y
     * quedaba "…inminente. ." en un documento que va ante un juez. */
    razon_urgencia: provisional && razon && razon !== "null"
      ? razon.slice(0, 300).replace(/\s*\.\s*$/, "")
      : null,
    motivo: String(r.motivo ?? "").slice(0, 300),
  };
}

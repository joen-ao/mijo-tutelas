/**
 * Prompt 3 de 3 — REDACTAR: los FUNDAMENTOS DE DERECHO, citando solo lo que existe.
 *
 * Aquí es donde un asistente jurídico se cae: inventa "T-855 de 2019" con una
 * frase que suena a Corte Constitucional y nadie la escribe nunca. La defensa
 * de este proyecto es de dos capas y esta es la primera:
 *
 *   1. El modelo NO conoce el corpus: solo ve los pasajes que le pasamos, y se
 *      le prohíbe citar cualquier cosa que no esté ahí.
 *   2. Además debe entregar cada cita PARTIDA en dos campos —el id de la
 *      sentencia y la frase textual— en vez de incrustarla en la prosa. Eso no
 *      es cosmético: convierte la verificación en una comparación de cadenas
 *      contra el corpus (lib/verificador.ts) en vez de un problema de parseo.
 *
 * La segunda capa es el verificador, que asume que este prompt igual va a
 * fallar alguna vez. Que el modelo se porte bien es deseable; que el código lo
 * compruebe es lo que hace que se pueda radicar.
 */
import { generarJSON } from "@/lib/llm";
import type { SentenciaRecuperada } from "@/lib/jurisprudencia";

export interface Cita {
  /** Id tal como está en el corpus: "T-760-08". */
  sentencia: string;
  /** La frase copiada LITERAL del pasaje. Es lo que el verificador compara. */
  frase: string;
}

export interface Fundamento {
  texto: string;
  citas: Cita[];
}

export interface Redaccion {
  derechos_vulnerados: string[];
  fundamentos: Fundamento[];
}

/** Los pasajes tal como los ve el modelo: numerados y con su id al lado. */
function bloquePasajes(sentencias: SentenciaRecuperada[]): string {
  if (!sentencias.length) return "(no se recuperó ninguna sentencia pertinente)";
  return sentencias
    .flatMap((s) =>
      s.pasajes.map(
        (p) => `--- SENTENCIA ${s.id} (${s.anio}, la Corte ${
          s.resultado === "concedida" ? "CONCEDIÓ" : s.resultado === "negada" ? "NEGÓ" : "decidió"
        } el amparo) · sección: ${p.seccion}\n${p.texto}`,
      ),
    )
    .join("\n\n");
}

export function promptRedactar(
  hechos: string,
  derecho: string,
  sentencias: SentenciaRecuperada[],
  refuerzo?: string,
): string {
  return `Eres un abogado colombiano redactando los FUNDAMENTOS DE DERECHO de una acción de tutela en salud.
${refuerzo ? `\n⚠️ INTENTO ANTERIOR RECHAZADO:\n${refuerzo}\n` : ""}
HECHOS DEL CASO:
"""
${hechos}
"""

DERECHO PRINCIPAL INVOCADO: ${derecho}

PASAJES DE JURISPRUDENCIA DISPONIBLES (lo ÚNICO que puedes citar):
"""
${bloquePasajes(sentencias)}
"""

REGLAS DE CITA — no negociables:
- SOLO puedes citar sentencias que aparezcan arriba, con el id EXACTO que se te dio.
- La "frase" de cada cita debe estar copiada CARÁCTER POR CARÁCTER de uno de esos
  pasajes. Ni resumida, ni corregida, ni con palabras cambiadas, ni traducida a un
  lenguaje más claro. Si necesitas recortar, recorta por los extremos, nunca por el
  medio, y no uses puntos suspensivos dentro de la frase.
- Frases de entre 10 y 60 palabras: una sola oración completa que sostenga el punto.
- PROHIBIDO citar cualquier sentencia que no esté en la lista, aunque estés seguro de
  que existe y de que dice lo que quieres. Si no hay pasaje pertinente para un punto,
  ARGUMENTA SIN CITA: la ley basta. Un fundamento sin cita es correcto; una cita
  inventada invalida el documento y perjudica a la persona.
- Un sistema automático va a comprobar cada frase contra el texto real de la
  sentencia y a borrar las que no coincidan. No hay nada que ganar adornando.

CÓMO ARGUMENTAR:
- Apóyate primero en la norma, que no necesita cita de jurisprudencia: art. 86 de la
  Constitución, Ley 1751 de 2015 (la salud es un derecho fundamental autónomo),
  Decreto 2591 de 1991.
- Conecta cada fundamento con los HECHOS concretos de esta persona. Nada de teoría
  general que sirva para cualquier expediente.
- 3 a 5 fundamentos. Párrafos de 3 a 6 líneas, en tercera persona y sobrios.
- No prometas resultados ni le hables al juez con familiaridad.

Responde SOLO este JSON:
{
  "derechos_vulnerados": ["salud", "vida digna"],
  "fundamentos": [
    {
      "texto": "párrafo del fundamento, sin las citas incrustadas",
      "citas": [{"sentencia": "T-760-08", "frase": "frase textual copiada del pasaje"}]
    }
  ]
}`;
}

function txt(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Redacta los fundamentos. Devuelve null si no hay LLM o si vino inservible.
 *
 * Ojo: esto NO verifica las citas, solo las recoge con la forma correcta. La
 * verificación es de lib/verificador.ts, y es obligatoria antes de que esto
 * llegue al PDF.
 */
export async function redactar(
  hechos: string,
  derecho: string,
  sentencias: SentenciaRecuperada[],
  refuerzo?: string,
): Promise<Redaccion | null> {
  const r = await generarJSON<Record<string, unknown>>(promptRedactar(hechos, derecho, sentencias, refuerzo));
  if (!r) return null;

  const fundamentos: Fundamento[] = Array.isArray(r.fundamentos)
    ? (r.fundamentos as Array<Record<string, unknown>>)
        .map((f) => ({
          texto: txt(f.texto),
          /* Máximo 2 citas por fundamento. El modelo tiende a apilar cinco
           * citas por párrafo y el resultado es un escrito inflado que ningún
           * juez lee con gusto; una tutela se sostiene con la ley y dos o tres
           * apoyos bien puestos. El recorte va aquí y no en el prompt porque es
           * una cuenta, no un juicio. */
          citas: Array.isArray(f.citas)
            ? (f.citas as Array<Record<string, unknown>>)
                .map((c) => ({ sentencia: txt(c.sentencia), frase: txt(c.frase) }))
                .filter((c) => c.sentencia && c.frase)
                .slice(0, 2)
            : [],
        }))
        .filter((f) => f.texto.length > 40)
    : [];

  if (!fundamentos.length) return null;

  return {
    derechos_vulnerados: Array.isArray(r.derechos_vulnerados)
      ? (r.derechos_vulnerados as unknown[]).map(txt).filter(Boolean)
      : [derecho],
    fundamentos,
  };
}

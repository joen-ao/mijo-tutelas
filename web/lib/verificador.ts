/**
 * EL VERIFICADOR — la pieza que hace que este documento se pueda radicar.
 *
 * Regla de oro del proyecto: el modelo emite juicios, el código emite hechos.
 * Qué derecho se vulneró, en qué orden pasaron las cosas y qué sentencia se
 * parece al caso son juicios, y ahí el LLM es irreemplazable. Si una cita
 * EXISTE no es un juicio: es un hecho comprobable contra el corpus. Eso no se
 * le pregunta a un modelo, se comprueba con código.
 *
 * Tres cosas se verifican, en este orden:
 *
 *   1. El id se puede leer            → si no, se descarta.
 *   2. El id existe en el corpus      → si no, la sentencia es inventada.
 *   3. La frase está LITERAL en ella  → si no, la cita es real pero puesta a
 *                                        decir algo que la Corte no dijo, que
 *                                        para un juez es igual de grave.
 *
 * El paso 3 es el que de verdad importa. Una sentencia inventada la caza
 * cualquiera; una sentencia real con una frase retocada —una negación que
 * desaparece, un "podrá" que se vuelve "deberá"— pasa todos los filtros
 * humanos y es la que hunde el caso.
 *
 * Lo que no se puede verificar se ELIMINA. Preferimos una tutela con una cita
 * menos que una con una cita falsa: la primera es más débil, la segunda le
 * explota en la cara a la persona frente al juez.
 */
import type { Redaccion, Cita, Fundamento } from "@/lib/prompts/redactar";

export type MotivoRechazo = "id_ilegible" | "id_inexistente" | "frase_no_literal" | "frase_muy_corta";

export interface CitaVerificada {
  /** Id canónico del corpus: "T-760-08". */
  sentencia: string;
  /** Como se escribe en el documento: "T-760 de 2008". */
  etiqueta: string;
  frase: string;
  anio: number;
  url: string;
  resultado: string;
  /** El sello: esta cita se comparó contra el texto de la sentencia y coincide. */
  verificada: true;
}

export interface CitaRechazada {
  sentencia: string;
  frase: string;
  motivo: MotivoRechazo;
  /** Para el eval y para explicarle al equipo qué pasó. */
  detalle: string;
}

export interface FundamentoVerificado {
  texto: string;
  citas: CitaVerificada[];
  /** true si el fundamento se quedó sin ninguna cita tras la verificación. */
  hueco: boolean;
}

export interface Verificacion {
  fundamentos: FundamentoVerificado[];
  derechos_vulnerados: string[];
  rechazadas: CitaRechazada[];
  /** Cuántas veces hubo que pedirle al modelo que rehiciera la redacción. */
  intentos: number;
}

/** Lo que el verificador necesita saber del corpus. Se inyecta para poder
 *  probarlo sin cargar 29 MB de índice en cada test. */
export interface Corpus {
  texto(id: string): string | null;
  meta(id: string): { anio: number; url: string; resultado: string } | null;
}

/* ── 1. Leer el id ───────────────────────────────────────────────────────── */

/*  Cubre todo lo que un modelo escribe en la práctica:
 *    T-760/08 · T-760-08 · T-760 de 2008 · T-760 del 2008 · T-760/2008
 *    SU-480/97 · C-313 de 2014 · Sentencia T-121 de 2015
 *  El guion puede ser el normal, el corto o la raya, porque los modelos
 *  alternan entre los tres sin motivo. */
const RE_CITA = /\b(SU|T|C|A)\s*[-–—]?\s*(\d{1,4})\s*(?:\/|[-–—]|\s+del?\s+)\s*(\d{2,4})\b/i;
const RE_CITA_G = new RegExp(RE_CITA.source, "gi");

/** "T-760 de 2008" → "T-760-08". Devuelve null si no se puede leer. */
export function normalizarId(bruto: string): string | null {
  const m = bruto.match(RE_CITA);
  if (!m) return null;
  const tipo = m[1].toUpperCase();
  const numero = parseInt(m[2], 10);
  const bruto3 = parseInt(m[3], 10);
  const anio = m[3].length === 4 ? bruto3 : bruto3 >= 92 ? 1900 + bruto3 : 2000 + bruto3;
  if (anio < 1992 || anio > 2022) return null;
  return `${tipo}-${String(numero).padStart(3, "0")}-${String(anio).slice(2)}`;
}

/** Todos los ids citados dentro de un texto libre (para auditar la prosa). */
export function extraerIds(texto: string): string[] {
  const ids = (texto.match(RE_CITA_G) ?? [])
    .map(normalizarId)
    .filter((x): x is string => Boolean(x));
  return [...new Set(ids)];
}

/** Cómo se escribe la cita en el documento: "T-760 de 2008". */
export function etiquetaDeId(id: string): string {
  const m = id.match(/^(SU|T|C|A)-(\d+)-(\d{2})$/);
  if (!m) return id;
  const yy = parseInt(m[3], 10);
  return `${m[1]}-${parseInt(m[2], 10)} de ${yy >= 92 ? 1900 + yy : 2000 + yy}`;
}

/* ── 2. Comparar la frase ────────────────────────────────────────────────── */

/**
 * Deja el texto en la forma mínima en que dos transcripciones del MISMO párrafo
 * tienen que coincidir.
 *
 * Se neutraliza lo que cambia al copiar y pegar sin cambiar lo que se dijo:
 * mayúsculas, tildes, comillas curvas contra rectas, las tres clases de guion,
 * saltos de línea y los marcadores de nota al pie ([3], [12]) que el corpus
 * trae incrustados en mitad de la frase.
 *
 * Nada de esto le abre la puerta a una cita inventada: cambiar una palabra,
 * quitar un "no" o suavizar un verbo sigue dando otra cadena. Lo único que
 * permite es que una cita legítima no se caiga por una comilla tipográfica.
 */
export function normalizarTexto(s: string): string {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    /* Las notas al pie se BORRAN, no se sustituyen por un espacio. Sustituirlas
     * dejaba "condiciones[14]." como "condiciones ." y el modelo, que cita sin
     * la nota, escribe "condiciones." — un carácter de diferencia que tumbaba
     * citas legítimas. Costaba un tercio de las citas buenas. */
    .replace(/\[\d+\]/g, "")
    .replace(/[""«»„]/g, '"')
    .replace(/['']/g, "'")
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    // El corpus separa el signo de la palabra ("condiciones ."); el modelo no.
    .replace(/\s+([.,;:!?)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .trim();
}

/* Una "cita" de cuatro palabras coincide con cualquier cosa y no sostiene nada.
 * El prompt pide entre 10 y 60 palabras; aquí se pone el piso duro. */
const MINIMO_PALABRAS = 6;

/**
 * Verifica UNA cita contra el corpus. Es la función que decide si algo llega
 * o no al documento.
 */
export function verificarCita(cita: Cita, corpus: Corpus): CitaVerificada | CitaRechazada {
  const id = normalizarId(cita.sentencia);
  if (!id) {
    return { sentencia: cita.sentencia, frase: cita.frase, motivo: "id_ilegible",
      detalle: `no se pudo interpretar "${cita.sentencia}" como una sentencia` };
  }

  const meta = corpus.meta(id);
  const texto = corpus.texto(id);
  if (!meta || texto === null) {
    return { sentencia: id, frase: cita.frase, motivo: "id_inexistente",
      detalle: `${id} no está en el corpus indexado de la Corte` };
  }

  if (cita.frase.trim().split(/\s+/).length < MINIMO_PALABRAS) {
    return { sentencia: id, frase: cita.frase, motivo: "frase_muy_corta",
      detalle: `la frase tiene menos de ${MINIMO_PALABRAS} palabras` };
  }

  const aguja = normalizarTexto(cita.frase);
  if (!normalizarTexto(texto).includes(aguja)) {
    return { sentencia: id, frase: cita.frase, motivo: "frase_no_literal",
      detalle: `${id} existe, pero esa frase no aparece en su texto` };
  }

  return {
    sentencia: id,
    etiqueta: etiquetaDeId(id),
    frase: cita.frase.trim(),
    anio: meta.anio,
    url: meta.url,
    resultado: meta.resultado,
    verificada: true,
  };
}

function esRechazo(x: CitaVerificada | CitaRechazada): x is CitaRechazada {
  return !("verificada" in x);
}

/** Pasa por el filtro los fundamentos de una redacción. */
function verificarFundamentos(
  fundamentos: Fundamento[], corpus: Corpus,
): { verificados: FundamentoVerificado[]; rechazadas: CitaRechazada[] } {
  const rechazadas: CitaRechazada[] = [];
  const verificados = fundamentos.map((f) => {
    const citas: CitaVerificada[] = [];
    for (const c of f.citas) {
      const r = verificarCita(c, corpus);
      if (esRechazo(r)) rechazadas.push(r);
      else citas.push(r);
    }
    return { texto: f.texto, citas, hueco: f.citas.length > 0 && citas.length === 0 };
  });
  return { verificados, rechazadas };
}

/* ── 3. El ciclo: verificar, reintentar, y si no, eliminar ───────────────── */

/** Cuántas veces se le pide al modelo que rehaga la redacción. */
export const MAX_REINTENTOS = 2;

/**
 * Verifica una redacción y, si hay citas malas, le pide al modelo que rehaga
 * —hasta MAX_REINTENTOS veces— diciéndole exactamente qué falló.
 *
 * Si al final siguen fallando, las citas malas se ELIMINAN y el fundamento
 * queda marcado como `hueco`. El texto del fundamento se conserva: el
 * argumento jurídico sigue siendo válido sin la cita, porque la ley basta.
 * Lo que no se conserva jamás es una cita sin verificar.
 *
 * `regenerar` recibe el detalle de lo rechazado para que el prompt pueda ser
 * concreto ("T-855-19 no existe"; "esta frase no está en T-760-08"). Devolver
 * null desde ahí corta el ciclo y se pasa a eliminar.
 */
export async function verificarRedaccion(
  redaccion: Redaccion,
  corpus: Corpus,
  regenerar?: (rechazadas: CitaRechazada[], intento: number) => Promise<Redaccion | null>,
): Promise<Verificacion> {
  let actual = redaccion;
  let intentos = 0;
  let { verificados, rechazadas } = verificarFundamentos(actual.fundamentos, corpus);

  while (rechazadas.length && regenerar && intentos < MAX_REINTENTOS) {
    intentos++;
    const nueva = await regenerar(rechazadas, intentos);
    if (!nueva) break;
    actual = nueva;
    ({ verificados, rechazadas } = verificarFundamentos(actual.fundamentos, corpus));
  }

  return {
    fundamentos: verificados,           // ya vienen sin las citas que no pasaron
    derechos_vulnerados: actual.derechos_vulnerados,
    rechazadas,
    intentos,
  };
}

/**
 * Texto para volver a pedirle la redacción al modelo. Se le dice qué falló y
 * por qué, en vez de repetirle el prompt igual y esperar otro resultado.
 */
export function instruccionesDeReintento(rechazadas: CitaRechazada[]): string {
  const lineas = rechazadas.map((r) => {
    if (r.motivo === "id_inexistente") return `- ${r.sentencia} NO EXISTE en el corpus. No la cites.`;
    if (r.motivo === "frase_no_literal") return `- En ${r.sentencia} la frase que citaste no aparece. Copia una frase EXACTA de los pasajes que te di, o no cites nada.`;
    if (r.motivo === "frase_muy_corta") return `- La cita de ${r.sentencia} es demasiado corta para sostener nada.`;
    return `- "${r.sentencia}" no se entiende como referencia de sentencia.`;
  });
  return `Se verificaron tus citas contra el texto real de las sentencias y estas FALLARON:
${lineas.join("\n")}

Rehaz los FUNDAMENTOS. Cita SOLO frases copiadas carácter por carácter de los pasajes
que te dieron. Si para un punto no hay una frase exacta que sirva, escribe el fundamento
SIN CITA: es preferible y es correcto.`;
}

/**
 * El corpus real. Se importa en diferido a propósito: así los tests del
 * verificador corren con un corpus de mentira y sin cargar el índice.
 */
export async function corpusDelIndice(): Promise<Corpus> {
  const { textoDeSentencia, sentenciaPorId } = await import("@/lib/jurisprudencia");
  return {
    texto: (id) => textoDeSentencia(id),
    meta: (id) => {
      const s = sentenciaPorId(id);
      return s ? { anio: s.anio, url: s.url, resultado: s.resultado } : null;
    },
  };
}

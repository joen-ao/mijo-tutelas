/**
 * Recuperación de jurisprudencia constitucional (RAG sobre el corpus de la
 * Corte Constitucional). Sucesor de lib/conocimiento.ts: conserva su
 * tokenización en español (stopwords + normalización de tildes), que estaba
 * bien resuelta, y cambia todo lo demás.
 *
 * Dos recuperadores, porque buscan cosas distintas:
 *
 *   · BM25 sobre los chunks — encuentra la sentencia que USA LAS MISMAS
 *     PALABRAS ("cáncer", "silla de ruedas", "Sanitas"). Es literal y preciso.
 *   · Coseno sobre embeddings del supuesto de hecho — encuentra la sentencia
 *     cuyos HECHOS SE PARECEN aunque no comparta vocabulario: "me negaron la
 *     quimio" contra "la EPS se abstuvo de suministrar el tratamiento
 *     oncológico". Eso es la analogía jurídica, y BM25 solo no la ve.
 *
 * Se fusionan con RRF (Reciprocal Rank Fusion): suma de 1/(k+puesto) sobre
 * cada ranking. Se usa RRF y no una suma ponderada de puntajes porque los dos
 * marcadores viven en escalas que no se pueden comparar —BM25 no está acotado,
 * el coseno va de -1 a 1— y normalizarlos exigiría calibrar un peso a mano.
 * RRF solo mira el orden.
 *
 * NO hay base vectorial, a propósito: son unos miles de vectores de 768
 * dimensiones en int8. El producto punto de todo el corpus contra la consulta
 * es un recorrido lineal sobre un Int8Array contiguo —milisegundos— y evita
 * operar, versionar y pagar un servicio aparte. Con este tamaño de corpus, un
 * índice ANN sería más infraestructura para el mismo resultado.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

export type Resultado = "concedida" | "negada" | "indeterminada";

/** Un pasaje citable: el trozo de sentencia del que el LLM puede tomar frases. */
export interface Pasaje {
  id: string;
  anio: number;
  url: string;
  resultado: Resultado;
  seccion: string;
  texto: string;
}

export interface SentenciaRecuperada {
  id: string;
  tipo: string;
  anio: number;
  url: string;
  resultado: Resultado;
  /** Los chunks de esta sentencia que mejor responden a la consulta. */
  pasajes: Pasaje[];
  puntaje: number;
}

interface Chunk { seccion: string; texto: string }
interface Sentencia {
  id: string; tipo: string; numero: number; anio: number; url: string;
  resultado: Resultado; supuesto: string; embedding: string | null; chunks: Chunk[];
}

/* ── Carga ───────────────────────────────────────────────────────────────── */

const RUTA = join(process.cwd(), "data", "sentencias", "indice.jsonl.gz");

function cargar(): Sentencia[] {
  try {
    return gunzipSync(readFileSync(RUTA))
      .toString("utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Sentencia);
  } catch {
    return []; // sin corpus indexado el bot sigue vivo, solo redacta sin citas
  }
}

const SENTENCIAS = cargar();

/** Índice por id, para que el verificador resuelva una cita en O(1). */
const POR_ID = new Map(SENTENCIAS.map((s) => [s.id, s]));

/* ── Tokenización (heredada de conocimiento.ts) ──────────────────────────── */

const STOP = new Set(["de", "la", "el", "en", "y", "a", "los", "las", "que", "con",
  "un", "una", "por", "para", "es", "se", "del", "al", "lo", "mi", "tu", "su",
  "como", "qué", "cual", "cuanto", "cuánto", "hay", "me", "te", "si", "no",
  // añadidos para lo jurídico: aparecen en TODAS las sentencias y no discriminan
  "corte", "constitucional", "sentencia", "tutela", "accion", "derecho",
  "derechos", "sala", "magistrado", "expediente", "articulo", "decreto"]);

function tokens(s: string): string[] {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/* ── BM25 ────────────────────────────────────────────────────────────────── */

const K1 = 1.5;  // saturación de frecuencia
const B = 0.75;  // peso de la normalización por longitud

/**
 * Índice invertido: término → los chunks donde aparece y cuántas veces.
 *
 * La versión ingenua guardaba un Map de frecuencias POR CHUNK y recorría los
 * veinte mil chunks en cada consulta. Con este corpus eso eran ~7 millones de
 * entradas de Map —cerca de un gigabyte— y una consulta lineal sobre todo el
 * índice. Invertirlo cambia las dos cosas: la memoria pasa a dos arreglos de
 * enteros por término, y una consulta solo toca los chunks que contienen
 * alguna de sus palabras.
 */
interface Postings { docs: number[]; tfs: number[] }
interface IndiceBM25 {
  postings: Map<string, Postings>;
  largos: Float32Array;
  largoMedio: number;
  /** chunk global → índice de la sentencia y posición del chunk dentro de ella. */
  deSentencia: Int32Array;
  local: Int32Array;
  total: number;
}

let _indice: IndiceBM25 | null = null;

/* Se arma en la primera búsqueda, no al importar: así el arranque del server no
 * paga por tokenizar el corpus entero, y el costo cae en una petición que de
 * todos modos está esperando varias llamadas al LLM. */
function indice(): IndiceBM25 {
  if (_indice) return _indice;

  const postings = new Map<string, Postings>();
  const largos: number[] = [];
  const deSentencia: number[] = [];
  const local: number[] = [];

  let d = 0;
  for (let i = 0; i < SENTENCIAS.length; i++) {
    const s = SENTENCIAS[i];
    for (let j = 0; j < s.chunks.length; j++) {
      const ts = tokens(s.chunks[j].texto);
      const tf = new Map<string, number>();
      for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const [t, f] of tf) {
        let p = postings.get(t);
        if (!p) { p = { docs: [], tfs: [] }; postings.set(t, p); }
        p.docs.push(d);
        p.tfs.push(f);
      }
      largos.push(ts.length);
      deSentencia.push(i);
      local.push(j);
      d++;
    }
  }

  _indice = {
    postings,
    largos: Float32Array.from(largos),
    largoMedio: largos.length ? largos.reduce((a, x) => a + x, 0) / largos.length : 1,
    deSentencia: Int32Array.from(deSentencia),
    local: Int32Array.from(local),
    total: d,
  };
  return _indice;
}

/** BM25 por chunk, agregado a la sentencia por su mejor pasaje. */
function rankingBM25(consulta: string): Map<number, { puntaje: number; chunks: number[] }> {
  const porSentencia = new Map<number, { puntaje: number; chunks: number[] }>();
  const q = tokens(consulta);
  if (!q.length || !SENTENCIAS.length) return porSentencia;

  const ix = indice();
  const puntajes = new Float64Array(ix.total);
  const tocados = new Set<number>();

  for (const t of new Set(q)) {
    const p = ix.postings.get(t);
    if (!p) continue;
    // IDF de Robertson con el +1 exterior: nunca negativo, ni con términos que
    // salen en más de la mitad del corpus (aquí "salud" o "eps" lo hacen).
    const idf = Math.log(1 + (ix.total - p.docs.length + 0.5) / (p.docs.length + 0.5));
    for (let i = 0; i < p.docs.length; i++) {
      const doc = p.docs[i];
      const f = p.tfs[i];
      puntajes[doc] += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * (ix.largos[doc] / ix.largoMedio)));
      tocados.add(doc);
    }
  }

  const ordenados = [...tocados].sort((a, b) => puntajes[b] - puntajes[a]);

  /* Una sentencia vale lo que vale su mejor pasaje: si un chunk responde de
   * lleno, que la sentencia tenga otros dos tibios no debería diluirlo. */
  for (const doc of ordenados) {
    const s = ix.deSentencia[doc];
    const prev = porSentencia.get(s);
    if (!prev) porSentencia.set(s, { puntaje: puntajes[doc], chunks: [ix.local[doc]] });
    else if (prev.chunks.length < 3) prev.chunks.push(ix.local[doc]);
  }
  return porSentencia;
}

/* ── Embeddings ──────────────────────────────────────────────────────────── */

const MODELO_EMB = "gemini-embedding-001";
const DIMS = 768;

/** int8 base64 → Int8Array, tal como los dejó scripts/indexar-sentencias.mjs. */
function decodificar(b64: string): Int8Array {
  const buf = Buffer.from(b64, "base64");
  return new Int8Array(buf.buffer, buf.byteOffset, buf.length);
}

const VECTORES: Array<Int8Array | null> = SENTENCIAS.map((s) =>
  s.embedding ? decodificar(s.embedding) : null,
);

function coseno(a: Int8Array, b: Float32Array): number {
  // a viene L2-normalizado del indexado y b se normaliza al pedirlo, así que
  // el producto punto ya es el coseno.
  let p = 0;
  for (let i = 0; i < a.length; i++) p += a[i] * b[i];
  return p / 127;
}

/** Embebe la consulta. Devuelve null si no hay clave o si Gemini falla. */
async function embeberConsulta(consulta: string): Promise<Float32Array | null> {
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_EMB}:embedContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${MODELO_EMB}`,
          content: { parts: [{ text: consulta }], role: "user" },
          // RETRIEVAL_QUERY, no RETRIEVAL_DOCUMENT: el modelo proyecta consulta
          // y documento a espacios distintos y hay que pedir el que toca.
          taskType: "RETRIEVAL_QUERY",
          outputDimensionality: DIMS,
        }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const v: number[] | undefined = data?.embedding?.values;
    if (!v?.length) return null;
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n) || 1;
    return Float32Array.from(v, (x) => x / n);
  } catch {
    return null;
  }
}

function rankingSemantico(q: Float32Array): number[] {
  const puntajes: Array<{ i: number; p: number }> = [];
  for (let i = 0; i < VECTORES.length; i++) {
    const v = VECTORES[i];
    if (v) puntajes.push({ i, p: coseno(v, q) });
  }
  puntajes.sort((a, b) => b.p - a.p);
  return puntajes.map((x) => x.i);
}

/* ── Fusión ──────────────────────────────────────────────────────────────── */

const RRF_K = 60; // constante estándar: amortigua el peso de los primeros puestos

/**
 * Busca las sentencias más pertinentes al relato.
 *
 * `consulta` debe ser el RELATO DE HECHOS, no la pregunta jurídica: el
 * recuperador semántico está indexado sobre supuestos de hecho, así que
 * compara caso contra caso.
 */
export async function buscarJurisprudencia(
  consulta: string, k = 5,
): Promise<SentenciaRecuperada[]> {
  if (!SENTENCIAS.length) return [];

  const bm25 = rankingBM25(consulta);
  const ordenBM25 = [...bm25.entries()].sort((a, b) => b[1].puntaje - a[1].puntaje).map((x) => x[0]);

  const qv = await embeberConsulta(consulta);
  const ordenSem = qv ? rankingSemantico(qv) : [];

  /* Solo se fusionan los primeros de cada lista: más abajo el orden es ruido y
   * meterlo entero deja que la cola de un ranking desplace la cabeza del otro. */
  const TOPE = 50;
  const rrf = new Map<number, number>();
  const sumar = (orden: number[]) => {
    orden.slice(0, TOPE).forEach((idx, puesto) => {
      rrf.set(idx, (rrf.get(idx) ?? 0) + 1 / (RRF_K + puesto + 1));
    });
  };
  sumar(ordenBM25);
  sumar(ordenSem);

  const fusionado = [...rrf.entries()]
    .map(([i, p]) => ({ i, p, s: SENTENCIAS[i] }))
    .sort((a, b) => {
      if (b.p !== a.p) return b.p - a.p;
      // Desempate: una sentencia donde la Corte AMPARÓ es mejor precedente para
      // quien va a pedir lo mismo que una donde negó con hechos parecidos.
      const rank = (r: Resultado) => (r === "concedida" ? 0 : r === "indeterminada" ? 1 : 2);
      if (rank(a.s.resultado) !== rank(b.s.resultado)) return rank(a.s.resultado) - rank(b.s.resultado);
      return b.s.anio - a.s.anio; // a igualdad, la más reciente
    })
    .slice(0, k);

  return fusionado.map(({ i, p, s }) => {
    const idxChunks = bm25.get(i)?.chunks ?? [0];
    return {
      id: s.id,
      tipo: s.tipo,
      anio: s.anio,
      url: s.url,
      resultado: s.resultado,
      puntaje: p,
      pasajes: idxChunks
        .filter((j) => s.chunks[j])
        .map((j) => ({
          id: s.id, anio: s.anio, url: s.url, resultado: s.resultado,
          seccion: s.chunks[j].seccion, texto: s.chunks[j].texto,
        })),
    };
  });
}

/**
 * "De las sentencias análogas a tu caso, la Corte concedió el amparo en N de M."
 *
 * Se cuentan SOLO las decisiones de tutela (T y SU) con resultado determinado.
 * Las de constitucionalidad (C) revisan leyes: no conceden ni niegan amparo, y
 * meterlas en el denominador haría bajar la cifra por una razón que no tiene
 * nada que ver con las probabilidades de quien consulta. Las indeterminadas
 * quedan fuera por lo mismo: no sabemos qué pasó, y contarlas como "no
 * concedidas" sería afirmar algo que el corpus no dice.
 */
export function estadisticaResultados(
  sentencias: SentenciaRecuperada[],
): { concedidas: number; total: number } {
  const tutelas = sentencias.filter(
    (s) => (s.tipo === "T" || s.tipo === "SU") && s.resultado !== "indeterminada",
  );
  return {
    concedidas: tutelas.filter((s) => s.resultado === "concedida").length,
    total: tutelas.length,
  };
}

/**
 * Todo el texto indexado de una sentencia, para que el verificador compruebe
 * que una frase citada existe de verdad. Devuelve null si el ID no está en el
 * corpus — que para el verificador significa "cita inventada".
 */
export function textoDeSentencia(id: string): string | null {
  const s = POR_ID.get(id);
  if (!s) return null;
  return s.chunks.map((c) => c.texto).join("\n");
}

/** Metadatos de una sentencia del corpus (o null si no existe). */
export function sentenciaPorId(id: string): { id: string; anio: number; url: string; resultado: Resultado } | null {
  const s = POR_ID.get(id);
  return s ? { id: s.id, anio: s.anio, url: s.url, resultado: s.resultado } : null;
}

/** Cuántas sentencias tiene cargadas el índice (para /health y el README). */
export function tamanoCorpus(): { sentencias: number; chunks: number; conEmbedding: number } {
  return {
    sentencias: SENTENCIAS.length,
    chunks: SENTENCIAS.reduce((a, s) => a + s.chunks.length, 0),
    conEmbedding: VECTORES.filter(Boolean).length,
  };
}

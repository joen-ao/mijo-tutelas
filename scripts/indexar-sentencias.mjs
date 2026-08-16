/**
 * Indexador del corpus de jurisprudencia constitucional colombiana.
 *
 * Fuente: dataset `Manuel/sentencias-corte-cons-colombia-1992-2021` de
 * HuggingFace (23.750 sentencias completas de la Corte Constitucional,
 * CC-BY-4.0). NO se scrapea corteconstitucional.gov.co: su robots.txt lo
 * prohíbe. El sitio solo se usa para construir el enlace de la fuente que
 * acompaña a cada cita verificada.
 *
 * Qué hace, en orden:
 *   1. Descarga el CSV (1,6 GB) en rangos paralelos, con reanudación.
 *   2. Lo lee en streaming y filtra las sentencias de SALUD.
 *   3. Etiqueta el resultado leyendo la parte resolutiva (RESUELVE).
 *   4. Trocea cada sentencia por secciones en chunks con solape.
 *   5. Calcula un embedding por sentencia sobre su supuesto de hecho.
 *   6. Escribe web/data/sentencias/indice.jsonl (una sentencia por línea).
 *
 * Uso:
 *   node scripts/indexar-sentencias.mjs                  # todo
 *   node scripts/indexar-sentencias.mjs --solo-contar    # filtra e informa
 *   node scripts/indexar-sentencias.mjs --sin-embeddings # sin llamar a Gemini
 *   node scripts/indexar-sentencias.mjs --limite 200     # prueba rápida
 *
 * Depende solo de Node ≥20 (fetch, streams, TextDecoder). Sin dependencias.
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, appendFileSync } from "node:fs";
import { createGzip } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(RAIZ, ".cache", "sentencias");
const CSV = join(CACHE, "Juris1992_2022.csv");
const CACHE_EMB = join(CACHE, "embeddings.jsonl");
const SALIDA_DIR = join(RAIZ, "web", "data", "sentencias");
const SALIDA = join(SALIDA_DIR, "indice.jsonl.gz");
const SALIDA_META = join(SALIDA_DIR, "meta.json");

const URL_DATASET =
  "https://huggingface.co/datasets/Manuel/sentencias-corte-cons-colombia-1992-2021/resolve/main/Juris1992_2022.csv";

const { values: arg } = parseArgs({
  options: {
    conexiones: { type: "string", default: "8" },
    csv: { type: "string" }, // usar un CSV local en vez de descargar (pruebas)
    limite: { type: "string" },
    "max-chunks": { type: "string", default: "3" },
    "min-fuertes": { type: "string", default: "2" },
    "min-salud": { type: "string", default: "5" },
    "solo-contar": { type: "boolean", default: false },
    "solo-descarga": { type: "boolean", default: false },
    "sin-embeddings": { type: "boolean", default: false },
  },
});

const CONEXIONES = parseInt(arg.conexiones, 10);
const LIMITE = arg.limite ? parseInt(arg.limite, 10) : Infinity;
const MAX_CHUNKS = parseInt(arg["max-chunks"], 10);
const MIN_FUERTES = parseInt(arg["min-fuertes"], 10);
const MIN_SALUD = parseInt(arg["min-salud"], 10);

/* ── 1. Descarga ─────────────────────────────────────────────────────────── */

/**
 * Deja el CSV completo en .cache/ y devuelve su ruta.
 *
 * Una sola conexión rendía ~20 MB/min contra el CDN de HuggingFace (84 min).
 * Partirlo en rangos paralelos lo baja a un rato razonable. Cada parte se
 * reanuda sola: si el archivo parcial ya existe, se pide el rango que falta.
 */
async function asegurarCorpus() {
  const total = await tamanoRemoto();
  if (existsSync(CSV) && statSync(CSV).size === total) {
    console.log(`· corpus en caché (${(total / 1e9).toFixed(2)} GB)`);
    return CSV;
  }
  mkdirSync(CACHE, { recursive: true });
  const porParte = Math.ceil(total / CONEXIONES);
  console.log(`· descargando ${(total / 1e9).toFixed(2)} GB en ${CONEXIONES} rangos…`);

  await Promise.all(
    Array.from({ length: CONEXIONES }, (_, i) => {
      const inicio = i * porParte;
      const fin = Math.min(inicio + porParte, total) - 1;
      return descargarParte(i, inicio, fin);
    }),
  );

  console.log("· uniendo partes…");
  const salida = createWriteStream(CSV);
  for (let i = 0; i < CONEXIONES; i++) {
    const parte = join(CACHE, `parte-${i}.bin`);
    await new Promise((ok, mal) => {
      const entrada = createReadStream(parte);
      entrada.on("error", mal);
      salida.on("error", mal);
      entrada.on("end", ok);
      entrada.pipe(salida, { end: false });
    });
  }
  await new Promise((ok) => salida.end(ok));
  for (let i = 0; i < CONEXIONES; i++) unlinkSync(join(CACHE, `parte-${i}.bin`));
  return CSV;
}

async function tamanoRemoto() {
  const res = await fetch(URL_DATASET, { method: "HEAD", redirect: "follow" });
  const n = parseInt(res.headers.get("content-length") ?? "0", 10);
  if (!n) throw new Error("no se pudo leer el tamaño del dataset");
  return n;
}

/**
 * Baja el rango [inicio, fin] a parte-i.bin, reanudando donde quedó.
 *
 * El CDN corta las conexiones largas con frecuencia: la caída a mitad de
 * transferencia es el caso normal, no el excepcional. Se relee del disco lo ya
 * escrito y se pide solo el resto, por eso son muchos intentos y no cinco.
 */
async function descargarParte(i, inicio, fin) {
  const ruta = join(CACHE, `parte-${i}.bin`);
  const esperado = fin - inicio + 1;
  let hecho = existsSync(ruta) ? statSync(ruta).size : 0;

  for (let intento = 0; intento < 60 && hecho < esperado; intento++) {
    let salida = null;
    try {
      const res = await fetch(URL_DATASET, {
        headers: { Range: `bytes=${inicio + hecho}-${fin}` },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      salida = createWriteStream(ruta, { flags: hecho ? "a" : "w" });
      for await (const bloque of res.body) {
        if (!salida.write(bloque)) await new Promise((ok) => salida.once("drain", ok));
      }
      await new Promise((ok) => salida.end(ok));
      salida = null;
    } catch {
      if (salida) await new Promise((ok) => salida.end(ok));
      await new Promise((ok) => setTimeout(ok, Math.min(20000, 1500 * (intento + 1))));
    }
    const ahora = existsSync(ruta) ? statSync(ruta).size : 0;
    if (ahora === hecho) await new Promise((ok) => setTimeout(ok, 5000)); // no avanzó
    hecho = ahora;
  }
  if (hecho < esperado) throw new Error(`parte ${i} incompleta (${hecho}/${esperado})`);
}

/* ── 2. Lectura del CSV ──────────────────────────────────────────────────── */

/**
 * Entrega {indice, texto} fila por fila sin cargar el archivo en memoria.
 *
 * El CSV es RFC4180: el texto de cada sentencia va entrecomillado, trae saltos
 * de línea y comillas internas duplicadas, así que partir por líneas no sirve.
 * Solo se conserva en memoria el registro que está a medio leer.
 */
async function* filasCSV(ruta) {
  const stream = createReadStream(ruta);
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let primera = true;

  for await (const bloque of stream) {
    buffer += decoder.decode(bloque, { stream: true });
    let consumido = 0;
    for (;;) {
      const reg = leerRegistro(buffer, consumido);
      if (!reg) break;
      consumido = reg.fin;
      if (primera) { primera = false; continue; } // cabecera ",Texto"
      yield { indice: reg.campos[0], texto: reg.campos[1] ?? "" };
    }
    if (consumido) buffer = buffer.slice(consumido);
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const reg = leerRegistro(buffer.endsWith("\n") ? buffer : buffer + "\n", 0);
    if (reg && !primera) yield { indice: reg.campos[0], texto: reg.campos[1] ?? "" };
  }
}

/** Un registro CSV desde `pos`, o null si todavía no llegó completo. */
function leerRegistro(s, pos) {
  if (pos >= s.length) return null;
  const campos = [];
  let i = pos;

  while (i < s.length) {
    let campo;
    if (s[i] === '"') {
      i++;
      let out = "";
      for (;;) {
        const q = s.indexOf('"', i);
        if (q === -1) return null;
        out += s.slice(i, q);
        if (s[q + 1] === '"') { out += '"'; i = q + 2; continue; }
        if (q + 1 >= s.length) return null; // no sabemos si sigue otra comilla
        i = q + 1;
        break;
      }
      campo = out;
    } else {
      let j = i;
      while (j < s.length && s[j] !== "," && s[j] !== "\n") j++;
      if (j >= s.length) return null;
      campo = s.slice(i, j).replace(/\r$/, "");
      i = j;
    }
    campos.push(campo);

    if (s[i] === ",") { i++; continue; }
    if (s[i] === "\r" && s[i + 1] === "\n") return { campos, fin: i + 2 };
    if (s[i] === "\n") return { campos, fin: i + 1 };
    if (i >= s.length) return null;
    i++; // carácter inesperado: seguir
  }
  return null;
}

/* ── 3. Filtro de salud ──────────────────────────────────────────────────── */

/** minúsculas, sin tildes, espacios colapsados. */
function normalizar(s) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

/* Términos que solo aparecen si el caso es de salud. Dos distintos bastan
 * para descartar el ruido de "salud" usado al pasar en cualquier sentencia. */
const FUERTES = [
  "eps", "entidad promotora de salud", "medico tratante", "medicamento",
  "plan obligatorio de salud", "plan de beneficios", "pos", "pbs",
  "sistema general de seguridad social en salud", "tratamiento medico",
  "procedimiento quirurgico", "cirugia", "historia clinica", "ips",
  "medicina prepagada", "afiliado al regimen", "orden medica",
];

/* Vocabulario de contexto: no basta por sí solo, pero sube la confianza. */
const CONTEXTO = [
  "minimo vital", "vida digna", "conexidad", "enfermedad", "diagnostico",
  "paciente", "incapacidad", "salud",
];

function analizarSalud(norm) {
  const fuertes = FUERTES.filter((t) => norm.includes(t));
  const contexto = CONTEXTO.filter((t) => norm.includes(t));
  const menciones = (norm.match(/\bsalud\b/g) ?? []).length;
  return {
    esSalud: fuertes.length >= MIN_FUERTES && menciones >= MIN_SALUD,
    fuertes,
    contexto,
    menciones,
  };
}

/* ── 4. Identificación y resultado ───────────────────────────────────────── */

const RE_ID = /\b(SU|T|C|A)\s*[-–]\s*(\d{1,4})\s*[-/]\s*(\d{2,4})\b/i;

function extraerId(texto) {
  const m = texto.slice(0, 600).match(RE_ID);
  if (!m) return null;
  const tipo = m[1].toUpperCase();
  const numero = parseInt(m[2], 10);
  const anio = m[3].length === 4
    ? parseInt(m[3], 10)
    : parseInt(m[3], 10) >= 92 ? 1900 + parseInt(m[3], 10) : 2000 + parseInt(m[3], 10);
  if (anio < 1992 || anio > 2022) return null;
  const yy = String(anio).slice(2);
  return {
    id: `${tipo}-${String(numero).padStart(3, "0")}-${yy}`,
    tipo,
    numero,
    anio,
    url: `https://www.corteconstitucional.gov.co/relatoria/${anio}/${tipo}-${String(numero).padStart(3, "0")}-${yy}.htm`,
  };
}

/* El encabezado va SIEMPRE en mayúsculas y a veces con las letras separadas
 * ("R E S U E L V E"). Exigir mayúscula no es cosmético: en minúscula
 * "resuelve"/"resuelvan" es un verbo corriente que aparece por todo el cuerpo
 * de la sentencia, y con `i` el corte de sección caía en cualquier párrafo. */
const RE_RESUELVE = /\bR\s?E\s?S\s?U\s?E\s?L\s?V\s?E\b/g;

/* Dentro de la parte resolutiva ya no hace falta exigir mayúscula: las
 * sentencias viejas escriben "Primero. Confirmar…" en versalita. Se listan
 * infinitivos e imperativos, no cualquier mención, así "revocar la sentencia
 * que negó el amparo" no cuenta como negada. */
const RE_CONCEDE = /\b(conceder|concede|concedase|concédase|concedese|concédese|tutelar|tutelase|tutélase|amparar|amparese|ampárese|otorgar|otorgase|otórgase|proteger|protéjase|protejase)\b/gi;
const RE_NIEGA = /\b(negar|niegase|niégase|denegar|denegase|deniegase|deniéguese|denieguese)\b/gi;
const RE_IMPROCEDENTE = /improcedente|improcedencia/i;

/* Órdenes de trámite: comunicar, notificar, librar oficios. No son amparo. */
const RE_ORDEN_TRAMITE = /secretar|comuni|notifi|publi|remit|archiv|desglos|l[ií]brese/i;

/**
 * Etiqueta el resultado leyendo SOLO la parte resolutiva.
 *
 * Se toma la ÚLTIMA aparición de RESUELVE porque antes de dictar la suya la
 * Corte transcribe la parte resolutiva de los fallos de instancia.
 *
 * Conceder gana sobre negar cuando aparecen los dos. No es un desempate
 * arbitrario: el patrón "REVOCAR … y en su lugar CONCEDER el amparo del
 * derecho a la salud … Asimismo, NEGAR el amparo del derecho a la seguridad
 * social" es un amparo parcial, y para quien consulta lo que importa es que la
 * Corte sí protegió. "Improcedente" cuenta como negada: el amparo no se
 * concedió, aunque haya sido por razones de procedencia y no de fondo.
 */
function etiquetaResultado(texto) {
  let ultima = -1;
  for (const m of texto.matchAll(RE_RESUELVE)) ultima = m.index;

  /* Sin encabezado (sentencias tempranas, textos truncados) la decisión está
   * igual al final: se mira la cola antes de rendirse. */
  const parte = ultima === -1 ? texto.slice(-4000) : texto.slice(ultima, ultima + 20000);

  const concede = (parte.match(RE_CONCEDE) ?? []).length;
  const niega = (parte.match(RE_NIEGA) ?? []).length;
  const improcedente = RE_IMPROCEDENTE.test(parte);

  if (concede > 0) return { resultado: "concedida", via: "verbo" };
  if (niega > 0 || improcedente) return { resultado: "negada", via: "verbo" };

  /* Aquí hubo una regla que heredaba el resultado del fallo confirmado
   * ("CONFIRMAR la sentencia … mediante la cual se denegó la tutela"). Se
   * quitó: en T-409-95 la Corte confirma un fallo que "a su vez revocó la
   * sentencia en virtud de la cual se había concedido la tutela" —dos
   * inversiones— y la regla la marcó como concedida cuando terminó negada.
   * Con revocaciones anidadas el verbo heredado dice lo contrario de lo que
   * pasó, así que se prefiere no etiquetar. */

  /* Una orden de fondo contra el accionado ("ORDENAR a la EPS que autorice…")
   * es un amparo concedido aunque el resuelve no use la palabra "conceder".
   * Se descartan las órdenes de trámite, que están en toda sentencia. */
  const ordenes = [...parte.matchAll(/\bORDENAR|\bORD[EÉ]NASE|\bDISPONER/gi)]
    .filter((m) => !RE_ORDEN_TRAMITE.test(parte.slice(m.index, m.index + 140)));
  if (ordenes.length) return { resultado: "concedida", via: "orden" };

  return { resultado: "indeterminada", via: "ninguna" };
}

/* ── 5. Secciones y chunks ───────────────────────────────────────────────── */

function primerIndice(texto, re) {
  const m = texto.match(re);
  return m ? m.index : -1;
}

function ultimoIndice(texto, re) {
  let ultimo = -1;
  for (const m of texto.matchAll(re)) ultimo = m.index;
  return ultimo;
}

/** Parte la sentencia en hechos / consideraciones / resuelve. */
function partirSecciones(texto) {
  const marcas = [];
  const hechos = primerIndice(texto, /\n\s*(?:[IVX]+\.?\s*)?ANTECEDENTES\b|\n\s*(?:[IVX]+\.?\s*)?HECHOS\b/i);
  const consid = primerIndice(texto, /\n\s*(?:[IVX]+\.?\s*)?CONSIDERACIONES\b|\n\s*(?:[IVX]+\.?\s*)?FUNDAMENTOS\b/i);
  const resuelve = ultimoIndice(texto, RE_RESUELVE);
  if (hechos >= 0) marcas.push({ seccion: "hechos", idx: hechos });
  if (consid >= 0) marcas.push({ seccion: "consideraciones", idx: consid });
  if (resuelve >= 0) marcas.push({ seccion: "resuelve", idx: resuelve });
  marcas.sort((a, b) => a.idx - b.idx);

  if (!marcas.length) return [{ seccion: "consideraciones", texto: texto.trim() }];
  return marcas.map((m, i) => ({
    seccion: m.seccion,
    texto: texto.slice(m.idx, marcas[i + 1]?.idx ?? texto.length).trim(),
  }));
}

/* ~1000 tokens. En español un token ronda 4 caracteres, y el solape evita que
 * una frase citable quede partida entre dos chunks y deje de ser verificable. */
const CHARS_CHUNK = 4000;
const CHARS_SOLAPE = 600;

function chunkear(texto) {
  const limpio = texto.replace(/[ \t]+/g, " ").trim();
  if (limpio.length <= CHARS_CHUNK) return limpio ? [limpio] : [];
  const trozos = [];
  let i = 0;
  while (i < limpio.length) {
    let fin = Math.min(i + CHARS_CHUNK, limpio.length);
    if (fin < limpio.length) {
      const corte = limpio.lastIndexOf(" ", fin);
      if (corte > i + CHARS_CHUNK / 2) fin = corte;
    }
    trozos.push(limpio.slice(i, fin).trim());
    if (fin >= limpio.length) break;
    i = fin - CHARS_SOLAPE;
  }
  return trozos.filter((t) => t.length > 200);
}

/* Las consideraciones son donde vive la doctrina citable; el resuelve da la
 * orden concreta; los hechos sirven para la analogía. Ese es el orden en que
 * se recortan cuando hay que quedarse con MAX_CHUNKS. */
const PRIORIDAD = { consideraciones: 0, resuelve: 1, hechos: 2 };

function chunksDeSentencia(texto) {
  const partes = partirSecciones(texto).flatMap((s) =>
    chunkear(s.texto).map((t) => ({ seccion: s.seccion, texto: t })),
  );
  return partes
    .sort((a, b) => PRIORIDAD[a.seccion] - PRIORIDAD[b.seccion])
    .slice(0, MAX_CHUNKS);
}

/** El supuesto de hecho: lo que se compara para encontrar casos análogos. */
function supuestoDeHecho(texto) {
  const secciones = partirSecciones(texto);
  const h = secciones.find((s) => s.seccion === "hechos");
  const base = (h?.texto ?? texto).replace(/\s+/g, " ").trim();
  return base.slice(0, 2000);
}

/* ── 6. Embeddings ───────────────────────────────────────────────────────── */

const MODELO_EMB = "gemini-embedding-001";
const DIMS = 768;

function claveGemini() {
  const env = join(RAIZ, "web", ".env.local");
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (!existsSync(env)) return "";
  const m = readFileSync(env, "utf-8").match(/^GEMINI_API_KEY=(.*)$/m);
  return (m?.[1] ?? "").trim();
}

/**
 * int8 + base64. Un embedding de 768 float ocupa ~9 KB en JSON y 1 KB así,
 * y el coseno entre vectores normalizados sobrevive a la cuantización con
 * un error muy por debajo de la diferencia entre dos sentencias distintas.
 */
function cuantizar(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  const b = Buffer.alloc(v.length);
  for (let i = 0; i < v.length; i++) {
    b[i] = Math.max(-127, Math.min(127, Math.round((v[i] / n) * 127))) & 0xff;
  }
  return b.toString("base64");
}

async function embeberLote(textos, key) {
  const body = {
    requests: textos.map((t) => ({
      model: `models/${MODELO_EMB}`,
      content: { parts: [{ text: t }], role: "user" },
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: DIMS,
    })),
  };
  for (let intento = 0; intento < 6; intento++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_EMB}:batchEmbedContents?key=${key}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    if (res.ok) {
      const data = await res.json();
      return data.embeddings.map((e) => cuantizar(e.values));
    }
    if (res.status === 429 || res.status >= 500) {
      const espera = 3000 * 2 ** intento;
      console.warn(`  embeddings HTTP ${res.status}, esperando ${espera / 1000}s…`);
      await new Promise((ok) => setTimeout(ok, espera));
      continue;
    }
    throw new Error(`embeddings HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error("embeddings: agotados los reintentos");
}

/**
 * Calcula los embeddings que falten, cacheando por id en .cache/.
 * Reindexar no vuelve a pagar lo ya calculado, que con miles de sentencias
 * es la diferencia entre 20 minutos y otra vez 20 minutos.
 */
async function embeberSentencias(docs) {
  const key = claveGemini();
  if (!key) {
    console.warn("· sin GEMINI_API_KEY: se indexa sin embeddings (solo BM25)");
    return new Map();
  }
  const cache = new Map();
  if (existsSync(CACHE_EMB)) {
    for (const linea of readFileSync(CACHE_EMB, "utf-8").split("\n")) {
      if (!linea.trim()) continue;
      try { const o = JSON.parse(linea); cache.set(o.id, o.e); } catch { /* línea a medio escribir */ }
    }
    console.log(`· ${cache.size} embeddings en caché`);
  }

  const faltan = docs.filter((d) => !cache.has(d.id));
  const LOTE = 100;
  for (let i = 0; i < faltan.length; i += LOTE) {
    const lote = faltan.slice(i, i + LOTE);
    const vs = await embeberLote(lote.map((d) => d.supuesto), key);
    let linea = "";
    lote.forEach((d, j) => {
      cache.set(d.id, vs[j]);
      linea += JSON.stringify({ id: d.id, e: vs[j] }) + "\n";
    });
    appendFileSync(CACHE_EMB, linea);
    process.stdout.write(`\r· embeddings ${Math.min(i + LOTE, faltan.length)}/${faltan.length}`);
  }
  if (faltan.length) process.stdout.write("\n");
  return cache;
}

/* ── 7. Main ─────────────────────────────────────────────────────────────── */

async function main() {
  const t0 = Date.now();
  const csv = arg.csv ? resolve(RAIZ, arg.csv) : await asegurarCorpus();
  if (arg["solo-descarga"]) return;

  console.log("· leyendo y filtrando…");
  const docs = [];
  const porAnio = new Map();
  const porResultado = { concedida: 0, negada: 0, indeterminada: 0 };
  let leidas = 0;
  let sinId = 0;

  for await (const fila of filasCSV(csv)) {
    leidas++;
    if (leidas % 2000 === 0) {
      process.stdout.write(`\r  ${leidas} leídas · ${docs.length} de salud`);
    }
    const texto = fila.texto;
    if (texto.length < 500) continue;

    const norm = normalizar(texto);
    const salud = analizarSalud(norm);
    if (!salud.esSalud) continue;

    const ident = extraerId(texto);
    if (!ident) { sinId++; continue; }

    const { resultado } = etiquetaResultado(texto);
    porResultado[resultado]++;
    porAnio.set(ident.anio, (porAnio.get(ident.anio) ?? 0) + 1);

    docs.push({
      ...ident,
      resultado,
      terminos: salud.fuertes.slice(0, 6),
      supuesto: supuestoDeHecho(texto),
      chunks: arg["solo-contar"] ? [] : chunksDeSentencia(texto),
    });
    if (docs.length >= LIMITE) break;
  }
  process.stdout.write(`\r  ${leidas} leídas · ${docs.length} de salud\n`);

  console.log("");
  console.log("═══ FILTRO DE SALUD ═══");
  console.log(`  sentencias en el dataset ......... ${leidas}`);
  console.log(`  de salud (tras el filtro) ........ ${docs.length}`);
  console.log(`  descartadas por no tener ID ...... ${sinId}`);
  console.log(`  umbral: ≥${MIN_FUERTES} términos fuertes y ≥${MIN_SALUD} menciones de "salud"`);
  console.log("");
  console.log("═══ RESULTADO (parte resolutiva) ═══");
  const tot = docs.length || 1;
  for (const [k, v] of Object.entries(porResultado)) {
    console.log(`  ${k.padEnd(16)} ${String(v).padStart(6)}  ${((v / tot) * 100).toFixed(1)}%`);
  }
  console.log("");
  const tipos = docs.reduce((a, d) => ({ ...a, [d.tipo]: (a[d.tipo] ?? 0) + 1 }), {});
  console.log(`═══ POR TIPO ═══\n  ${Object.entries(tipos).map(([k, v]) => `${k}: ${v}`).join(" · ")}`);
  console.log("");

  if (arg["solo-contar"]) return;

  const emb = arg["sin-embeddings"] ? new Map() : await embeberSentencias(docs);

  mkdirSync(SALIDA_DIR, { recursive: true });
  /* Gzip: el índice sin comprimir pasa de 90 MB y el texto jurídico comprime a
   * menos de un tercio. Cabe en el repo y descomprimirlo al arrancar cuesta
   * un segundo, contra los minutos que tomaría regenerarlo desde el CSV. */
  const gz = createGzip({ level: 9 });
  const out = createWriteStream(SALIDA);
  gz.pipe(out);
  for (const d of docs) {
    gz.write(JSON.stringify({
      id: d.id,
      tipo: d.tipo,
      numero: d.numero,
      anio: d.anio,
      url: d.url,
      resultado: d.resultado,
      terminos: d.terminos,
      supuesto: d.supuesto.slice(0, 400),
      embedding: emb.get(d.id) ?? null,
      chunks: d.chunks,
    }) + "\n");
  }
  gz.end();
  await new Promise((ok) => out.on("close", ok));

  const meta = {
    generado: new Date().toISOString(),
    fuente: "HuggingFace · Manuel/sentencias-corte-cons-colombia-1992-2021 (CC-BY-4.0)",
    sentenciasLeidas: leidas,
    sentenciasSalud: docs.length,
    chunks: docs.reduce((a, d) => a + d.chunks.length, 0),
    conEmbedding: docs.filter((d) => emb.has(d.id)).length,
    modeloEmbedding: arg["sin-embeddings"] ? null : `${MODELO_EMB} (${DIMS}d, int8)`,
    porResultado,
    umbrales: { minFuertes: MIN_FUERTES, minSalud: MIN_SALUD, maxChunks: MAX_CHUNKS },
  };
  mkdirSync(SALIDA_DIR, { recursive: true });
  createWriteStream(SALIDA_META).end(JSON.stringify(meta, null, 2) + "\n");

  console.log(`· índice → ${SALIDA} (${(statSync(SALIDA).size / 1e6).toFixed(1)} MB, ${meta.chunks} chunks)`);
  console.log(`· listo en ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`);
}

/* Solo corre si se invoca directo; así el diagnóstico y el eval pueden
 * importar las funciones sin disparar la indexación entera. */
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { filasCSV, normalizar, analizarSalud, extraerId, etiquetaResultado, partirSecciones, chunksDeSentencia, supuestoDeHecho, RE_RESUELVE };

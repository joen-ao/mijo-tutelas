/**
 * El documento: qué lleva un derecho de petición y dónde vive mientras se
 * convierte en PDF.
 *
 * Mismo patrón que lib/tutela.ts, y a propósito: el almacén es en memoria, la
 * página /peticion lo lee por ?id= para pintarlo y Chromium lo imprime en el
 * mismo proceso. Un expediente completo no cabe en una query string.
 *
 * La diferencia de fondo con la tutela no es el formato del papel: la tutela se
 * dirige a un JUEZ y la petición se dirige a la ENTIDAD. No hay juzgado, no hay
 * reparto y no hay fallo — hay un término que empieza a correr el día que la
 * entidad la recibe. Ese término lo calcula este archivo, no un modelo.
 */
import { randomUUID } from "node:crypto";

import { plazoMaximoConProrroga, plazoPeticion, type TipoPeticion } from "@/lib/prompts/triaje";

export interface HechoPeticion {
  numero: number;
  texto: string;
  fecha: string | null;
}

export interface Peticion {
  /** La ENTIDAD, no un juzgado. `correo` es a dónde se radica. */
  destinatario: { nombre: string; tipo: string; ciudad: string; correo: string | null };
  /** telefono y correo van en NOTIFICACIONES: es por donde la entidad responde,
   *  y el art. 16 num. 5 de la Ley 1755 pide justamente la dirección donde se
   *  recibirá la respuesta. La dirección física queda en blanco: no se pregunta. */
  peticionario: { nombre: string; cedula: string; ciudad: string; telefono: string; correo: string };
  /** Una línea: qué se pide, para el asunto y la referencia. */
  objeto: string;
  hechos: HechoPeticion[];
  /** Lo que se le pide a la entidad, en imperativo y numerado. */
  peticiones: string[];
  /** Modalidad del art. 14: de ella depende el término. */
  tipo: TipoPeticion;
  /** Lo que la persona describió como negado o pendiente. */
  que_pide: string;
  diagnostico: string | null;
  /** ISO. Se fija al generar para que el PDF no cambie si se reimprime. */
  fecha: string;
}

interface Entrada { doc: Peticion; exp: number }
const g = globalThis as unknown as { __peticiones?: Map<string, Entrada> };
const peticiones: Map<string, Entrada> = g.__peticiones ?? (g.__peticiones = new Map());

/* Mismo TTL que las tutelas y por la misma razón: entre que se arma, Chromium
 * lo imprime y Twilio lo descarga pueden pasar varios minutos. */
const TTL_MS = 60 * 60 * 1000;

export function guardarPeticion(doc: Peticion): string {
  const id = randomUUID();
  peticiones.set(id, { doc, exp: Date.now() + TTL_MS });
  for (const [k, v] of peticiones) if (v.exp < Date.now()) peticiones.delete(k); // limpieza perezosa
  return id;
}

export function obtenerPeticion(id: string): Peticion | null {
  const e = peticiones.get(id);
  if (!e || e.exp < Date.now()) return null;
  return e.doc;
}

/* ── Días hábiles: aritmética, no criterio ───────────────────────────────── */

/**
 * Domingo de Pascua (algoritmo de Meeus/Jones/Butcher, calendario gregoriano).
 * Hace falta porque cuatro festivos colombianos se cuelgan de esa fecha.
 */
function domingoDePascua(anio: number): Date {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const gg = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - gg + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(anio, mes - 1, dia));
}

/** Clave "MM-DD" en UTC, para comparar fechas sin arrastrar husos horarios. */
function clave(d: Date): string {
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function sumarDias(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

/** Ley 51 de 1983 ("Emiliani"): estos festivos se trasladan al lunes siguiente. */
function alLunesSiguiente(d: Date): Date {
  const diasHastaLunes = (8 - d.getUTCDay()) % 7;
  return sumarDias(d, diasHastaLunes);
}

/**
 * Festivos colombianos de un año, como set de "MM-DD".
 *
 * Se calculan y no se listan a mano porque una tabla escrita a mano se vence en
 * enero y nadie se entera hasta que un plazo sale mal. Los que se mueven al
 * lunes son los de la Ley 51 de 1983; Jueves y Viernes Santo NO se mueven.
 */
function festivos(anio: number): Set<string> {
  const fijos = ["01-01", "05-01", "07-20", "08-07", "12-08", "12-25"];
  const trasladables: Array<[number, number]> = [
    [1, 6],   // Reyes Magos
    [3, 19],  // San José
    [6, 29],  // San Pedro y San Pablo
    [8, 15],  // Asunción de la Virgen
    [10, 12], // Día de la Raza
    [11, 1],  // Todos los Santos
    [11, 11], // Independencia de Cartagena
  ];

  const out = new Set(fijos);
  for (const [mes, dia] of trasladables) {
    out.add(clave(alLunesSiguiente(new Date(Date.UTC(anio, mes - 1, dia)))));
  }

  const pascua = domingoDePascua(anio);
  out.add(clave(sumarDias(pascua, -3)));               // Jueves Santo, no se traslada
  out.add(clave(sumarDias(pascua, -2)));               // Viernes Santo, no se traslada
  out.add(clave(alLunesSiguiente(sumarDias(pascua, 39))));  // Ascensión
  out.add(clave(alLunesSiguiente(sumarDias(pascua, 60))));  // Corpus Christi
  out.add(clave(alLunesSiguiente(sumarDias(pascua, 68))));  // Sagrado Corazón
  return out;
}

const cacheFestivos = new Map<number, Set<string>>();

function esHabil(d: Date): boolean {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const anio = d.getUTCFullYear();
  let f = cacheFestivos.get(anio);
  if (!f) { f = festivos(anio); cacheFestivos.set(anio, f); }
  return !f.has(clave(d));
}

/**
 * Suma días hábiles a una fecha. El día de radicación NO cuenta: el art. 14
 * dice «dentro de los quince (15) días SIGUIENTES a su recepción», así que se
 * empieza a contar desde el día hábil siguiente.
 */
export function sumarDiasHabiles(desdeIso: string, dias: number): Date {
  const base = new Date(desdeIso);
  let d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  let quedan = dias;
  while (quedan > 0) {
    d = sumarDias(d, 1);
    if (esHabil(d)) quedan--;
  }
  return d;
}

/**
 * Cuándo se le vence el término a la entidad si radica hoy.
 *
 * Es UNA ESTIMACIÓN y así se rotula en el documento, por una razón concreta: el
 * término corre desde que la entidad RECIBE la petición, no desde que Mijo
 * imprime el PDF, y entre lo uno y lo otro puede pasar un día o una semana. Por
 * eso el PDF dice también el número de días, que es el dato que no se desfasa.
 */
export function vencimiento(doc: Peticion): { dias: number; maximo: number; fecha: Date } {
  const dias = plazoPeticion(doc.tipo);
  return { dias, maximo: plazoMaximoConProrroga(doc.tipo), fecha: sumarDiasHabiles(doc.fecha, dias) };
}

/* ── Texto que se calcula, no se le pide al modelo ───────────────────────── */

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "15 de agosto de 2026" — como se fecha un escrito. */
export function fechaLargaUtc(d: Date): string {
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

export function fechaLargaIso(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

/** Cómo se llama la modalidad en el propio documento. */
export function nombreDelTipo(tipo: TipoPeticion): string {
  switch (tipo) {
    case "documentos_informacion": return "petición de documentos e información";
    case "consulta": return "consulta";
    case "general": return "petición en interés particular";
  }
}

/** El artículo exacto del que sale el término, para citarlo en el escrito. */
export function articuloDelTermino(tipo: TipoPeticion): string {
  switch (tipo) {
    case "documentos_informacion": return "artículo 14, numeral 1, de la Ley 1755 de 2015";
    case "consulta": return "artículo 14, numeral 2, de la Ley 1755 de 2015";
    case "general": return "artículo 14 de la Ley 1755 de 2015";
  }
}

/**
 * Limpia la frase negativa para incrustarla en una afirmativa.
 *
 * Mismo problema y misma solución que frasePedido() en lib/tutela.ts: lo que la
 * persona cuenta viene en negativo ("no me quieren autorizar la resonancia ni
 * las terapias") y aquí se usa en positivo ("solicito que se autorice…"). Es
 * gramática, no criterio.
 */
export function fraseSolicitud(x: string): string {
  return (x || "")
    .trim()
    .replace(/\s+ni\s+/gi, " y ")
    .replace(/^no\s+/i, "")
    .trim();
}

/* ── Armado del documento ────────────────────────────────────────────────── */

/**
 * Peticiones de respaldo cuando no hay ninguna redactada.
 *
 * Se piden TRES cosas siempre y no solo el servicio: la autorización, la
 * respuesta escrita y los soportes. Las dos últimas son las que convierten esta
 * petición en la prueba de la tutela que viene después si la entidad no cumple
 * — sin ellas, quedarse con la negativa de palabra es quedarse sin nada.
 */
function peticionesPorDefecto(quePide: string, entidad: string): string[] {
  const qp = fraseSolicitud(quePide) || "el servicio ordenado por el médico tratante";
  return [
    `AUTORIZAR y entregar ${qp}, indicando fecha, lugar y hora de la prestación.`,
    "RESPONDER esta petición por escrito, de fondo y de manera completa, en el término legal.",
    "REMITIR copia de los soportes de la decisión: si la respuesta es negativa, indicar "
    + "expresamente la norma en que se funda y el procedimiento para controvertirla.",
  ];
}

/**
 * Arma el documento a partir de lo que el flujo ya tiene.
 *
 * Es una función PURA: no llama al modelo. Los hechos ya vienen estructurados
 * (prompts/estructurar.ts los produce para la tutela y sirven igual aquí), y
 * todo lo demás —el término, el artículo, la fecha— lo pone el código.
 */
export function construirPeticion(params: {
  hechos: HechoPeticion[];
  peticiones?: string[];
  tipo: TipoPeticion;
  entidad: { nombre: string; tipo?: string; correo?: string | null };
  peticionario: { nombre: string; cedula: string; ciudad: string; telefono?: string; correo?: string };
  que_pide: string;
  diagnostico?: string | null;
}): Peticion {
  const entidad = params.entidad.nombre || "";
  const objeto = fraseSolicitud(params.que_pide) || "la prestación del servicio de salud ordenado";
  return {
    destinatario: {
      nombre: entidad,
      tipo: params.entidad.tipo || "EPS",
      ciudad: params.peticionario.ciudad || "",
      correo: params.entidad.correo ?? null,
    },
    peticionario: {
      nombre: params.peticionario.nombre || "",
      cedula: params.peticionario.cedula || "",
      ciudad: params.peticionario.ciudad || "",
      telefono: params.peticionario.telefono || "",
      correo: params.peticionario.correo || "",
    },
    objeto,
    hechos: params.hechos,
    peticiones: params.peticiones?.length
      ? params.peticiones
      : peticionesPorDefecto(params.que_pide, entidad),
    tipo: params.tipo,
    que_pide: params.que_pide,
    diagnostico: params.diagnostico ?? null,
    fecha: new Date().toISOString(),
  };
}

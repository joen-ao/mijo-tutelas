/**
 * El documento: qué lleva una acción de tutela y dónde vive mientras se
 * convierte en PDF.
 *
 * El almacén es en memoria, igual que imgStore y audioStore: la página
 * /tutela lo lee para pintar el documento y Chromium lo imprime en el mismo
 * proceso. No se pasa por query string porque un expediente completo no cabe
 * en una URL.
 */
import { randomUUID } from "node:crypto";
import type { CitaVerificada } from "@/lib/verificador";

export interface HechoDoc {
  numero: number;
  texto: string;
  fecha: string | null;
}

export interface FundamentoDoc {
  texto: string;
  citas: CitaVerificada[];
}

export interface Tutela {
  /** telefono y correo van en NOTIFICACIONES: el juzgado notifica por ahí, y
   *  dejarlos en blanco obliga a la persona a llenarlos a mano teniéndolos
   *  nosotros. La dirección sí queda en blanco: nunca se la preguntamos. */
  accionante: { nombre: string; cedula: string; ciudad: string; telefono: string; correo: string };
  accionado: { nombre: string; tipo: string };
  hechos: HechoDoc[];
  derechos_vulnerados: string[];
  pretensiones: string[];
  fundamentos: FundamentoDoc[];
  /** Se pide al juez suspender la negativa mientras falla (art. 7 D. 2591). */
  medida_provisional: boolean;
  /** Qué daño concreto ocurre si la persona espera. Lo que sostiene la medida. */
  razon_urgencia: string | null;
  /** Lo que la persona describió como negado, para los anexos. */
  que_negaron: string;
  diagnostico: string | null;
  /** ISO. Se fija al generar para que el PDF no cambie si se reimprime. */
  fecha: string;
}

interface Entrada { doc: Tutela; exp: number }
const g = globalThis as unknown as { __tutelas?: Map<string, Entrada> };
const tutelas: Map<string, Entrada> = g.__tutelas ?? (g.__tutelas = new Map());

/* Más largo que el de las imágenes: entre que se arma el documento, Chromium
 * lo imprime y Twilio lo descarga pueden pasar varios minutos. */
const TTL_MS = 60 * 60 * 1000;

export function guardarTutela(doc: Tutela): string {
  const id = randomUUID();
  tutelas.set(id, { doc, exp: Date.now() + TTL_MS });
  for (const [k, v] of tutelas) if (v.exp < Date.now()) tutelas.delete(k); // limpieza perezosa
  return id;
}

export function obtenerTutela(id: string): Tutela | null {
  const e = tutelas.get(id);
  if (!e || e.exp < Date.now()) return null;
  return e.doc;
}

/* ── Texto que se calcula, no se le pide al modelo ───────────────────────── */

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "15 de agosto de 2026" — como se fecha un escrito judicial. */
export function fechaLarga(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

/**
 * Une una lista en castellano: "salud, vida digna y seguridad social".
 * Se hace aquí y no en el prompt porque es formato, no juicio.
 */
export function enumerar(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

/**
 * Contrae "de el" en "del" y limpia la negación heredada.
 *
 * `que_negaron` se extrae de una frase NEGATIVA ("no me quieren autorizar el
 * concentrador ni las terapias") y luego se incrusta en una AFIRMATIVA ("que
 * ordene entregarte…"). Sin esto sale "entregarte el concentrador ni las
 * terapias" y "la orden médica de el concentrador". Es gramática, no criterio:
 * lo arregla el código.
 */
export function frasePedido(x: string): string {
  return (x || "")
    .trim()
    .replace(/\s+ni\s+/gi, " y ")      // "el concentrador ni las terapias"
    .replace(/^no\s+/i, "")
    .trim();
}

/** "de" + frase, contrayendo "de el" → "del". */
export function de(x: string): string {
  const f = frasePedido(x);
  return /^el\s/i.test(f) ? `del ${f.slice(3)}` : `de ${f}`;
}

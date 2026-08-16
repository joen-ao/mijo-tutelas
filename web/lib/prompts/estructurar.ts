/**
 * Prompt 2 de 3 — ESTRUCTURAR: del desahogo a los HECHOS numerados.
 *
 * Este es el trabajo que de verdad hace un abogado y el que nadie puede hacer
 * con plantillas. La persona escribe "llevo desde enero rogando, me mandaron de
 * la Kennedy a la 68 y nadie me da razón, mi mamá no aguanta el dolor". Un juez
 * necesita: hecho 1, fecha; hecho 2, fecha; hecho 3, fecha; y una pretensión
 * concreta. Convertir lo uno en lo otro es reescritura con criterio jurídico —
 * decidir qué es jurídicamente relevante, en qué orden ocurrió y qué se pide—,
 * no formateo.
 *
 * Restricción dura: NO inventar. Si la fecha no está, va null y el flujo la
 * pregunta. Un hecho con fecha inventada en un documento que se radica ante un
 * juez es un problema serio, no un detalle de UX.
 */
import { generarJSON } from "@/lib/llm";

export interface Hecho {
  numero: number;
  texto: string;
  /** Como la dijo la persona ("12 de marzo", "hace dos meses") o null. */
  fecha: string | null;
}

export interface Estructura {
  accionante: { nombre: string; cedula: string; ciudad: string };
  accionado: { nombre: string; tipo: string };
  hechos: Hecho[];
  pretensiones: string[];
}

export function promptEstructurar(
  relato: string,
  datos: Record<string, unknown>,
): string {
  return `Eres un abogado colombiano redactando los HECHOS de una acción de tutela en salud.

RELATO DE LA PERSONA (en desorden, como lo contó):
"""
${relato}
"""

DATOS QUE YA CONFIRMÓ EN LA CONVERSACIÓN (tienen prioridad sobre el relato):
"""
${JSON.stringify(datos, null, 2)}
"""

Tu trabajo:

1. HECHOS: reescribe el relato como hechos NUMERADOS en ORDEN CRONOLÓGICO.
   - Un hecho por suceso jurídicamente relevante. Ni un párrafo entero como
     "hecho 1", ni una frase partida en cinco.
   - Redacta en tercera persona y en pasado, sobrio y sin adjetivos
     ("La accionada negó la autorización", no "me trataron pésimo").
   - Conserva TODO lo probatorio: nombres de médicos, diagnósticos, códigos de
     autorización, nombres de sedes, cuántas veces fue, qué le respondieron.
   - Lo que la persona siente NO es un hecho, salvo que sea clínico (dolor,
     deterioro, ansiedad diagnosticada).
   - fecha: SOLO si aparece en el relato o en los datos. Si no está, null.
     PROHIBIDO deducir, estimar o rellenar fechas.
   - Si el relato no alcanza para un hecho, no lo inventes: menos hechos ciertos
     valen más que muchos hechos adornados.

2. PRETENSIONES: qué se le pide al juez, en imperativo y concreto. Cada una
   empieza con un verbo ("ORDENAR a la EPS que autorice…", "TUTELAR el derecho
   fundamental a la salud…"). Incluye siempre el tratamiento INTEGRAL cuando se
   trate de una patología en curso. No pidas dinero: la tutela no es para eso.

3. Nombres y cédula: úsalos EXACTAMENTE como están en los datos confirmados. Si
   falta alguno, deja "" y no inventes.

Responde SOLO este JSON:
{
  "accionante": {"nombre": "", "cedula": "", "ciudad": ""},
  "accionado": {"nombre": "", "tipo": "EPS"},
  "hechos": [{"numero": 1, "texto": "", "fecha": "2026-03-12 o null"}],
  "pretensiones": [""]
}`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

/**
 * Una fecha que la persona NO dijo no entra al documento.
 *
 * Esto no está de más aunque el prompt lo prohíba: en las pruebas el modelo
 * recibió "el 3 de junio" y devolvió "2024-06-03". Se inventó el año, y encima
 * mal. En un escrito que se radica, una fecha que contradice las pruebas es de
 * las pocas cosas que pueden hundir el caso solas.
 *
 * Misma lógica que con las citas: que la fecha esté en el relato no es un
 * juicio del modelo, es una cadena que se puede buscar. Lo comprueba el código.
 *
 * Si el modelo reformateó, se reconstruye la fecha con el día y el mes —que sí
 * están en el relato— y se descarta el año inventado. Si ni eso aparece, la
 * fecha se pierde: el hecho sale sin fecha, que es correcto y honesto.
 */
function fechaSoloSiLaDijo(bruta: string, relato: string): string | null {
  const f = bruta.trim();
  if (!f || f.toLowerCase() === "null") return null;

  const r = norm(relato);
  if (r.includes(norm(f))) return f; // la dijo tal cual

  let dia: string | null = null;
  let mes: string | null = null;

  const iso = f.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    mes = MESES[parseInt(iso[2], 10) - 1] ?? null;
    dia = String(parseInt(iso[3], 10));
  } else {
    const m = norm(f).match(/(\d{1,2})\s*(?:de\s+)?([a-z]+)/);
    if (m && MESES.includes(m[2])) { dia = String(parseInt(m[1], 10)); mes = m[2]; }
  }
  if (!dia || !mes) return null;

  // ¿El relato menciona ese día con ese mes? Solo entonces se conserva.
  return new RegExp(`\\b${dia}\\s*(?:de\\s+)?${mes}\\b`).test(r) ? `${dia} de ${mes}` : null;
}

function txt(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Estructura el relato. Devuelve null si no hay LLM o si vino inservible.
 *
 * Los datos ya confirmados en la conversación PISAN lo que diga el modelo para
 * nombre, cédula, ciudad y accionado: son campos de identificación y ahí el
 * dato bueno es el que la persona escribió, no el que el modelo interpretó.
 */
export async function estructurar(
  relato: string,
  datos: Record<string, unknown>,
): Promise<Estructura | null> {
  const r = await generarJSON<Record<string, unknown>>(promptEstructurar(relato, datos));
  if (!r) return null;

  const acc = (r.accionante ?? {}) as Record<string, unknown>;
  const dem = (r.accionado ?? {}) as Record<string, unknown>;

  const hechos: Hecho[] = Array.isArray(r.hechos)
    ? (r.hechos as Array<Record<string, unknown>>)
        .map((h, i) => ({
          numero: i + 1, // se renumera aquí: el modelo a veces salta o repite
          texto: txt(h.texto),
          fecha: fechaSoloSiLaDijo(txt(h.fecha), relato),
        }))
        .filter((h) => h.texto.length > 10)
    : [];

  const pretensiones: string[] = Array.isArray(r.pretensiones)
    ? (r.pretensiones as unknown[]).map(txt).filter((p) => p.length > 10)
    : [];

  if (!hechos.length) return null; // sin hechos no hay tutela que radicar

  return {
    accionante: {
      nombre: txt(datos.nombre) || txt(acc.nombre),
      cedula: txt(datos.cedula) || txt(acc.cedula),
      ciudad: txt(datos.ciudad) || txt(acc.ciudad),
    },
    accionado: {
      nombre: txt(datos.accionado) || txt(dem.nombre),
      tipo: txt(dem.tipo) || "EPS",
    },
    hechos,
    pretensiones,
  };
}

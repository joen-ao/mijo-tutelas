/**
 * ¿Dijo que sí, o que no?
 *
 * Vive aparte porque lo necesitan tres sitios —el consentimiento para radicar,
 * la confirmación del correo por teléfono y la respuesta al seguimiento— y
 * porque equivocarse cuesta caro en los tres.
 *
 * DOS TRAMPAS QUE COSTARON BUGS REALES:
 *
 * 1. `\b` NO cierra límite junto a una vocal acentuada. En "sí", el `\b` final
 *    tendría que caer después de la "í", que en regex ASCII no es carácter de
 *    palabra — así que /\bsí\b/ nunca matchea. Y el reconocimiento de voz
 *    transcribe CON tilde. Por eso se normaliza ANTES de comparar, nunca a
 *    fuerza de meter variantes en la expresión.
 *
 * 2. La gente no contesta "sí": contesta con la orden. A la pregunta "¿quieres
 *    que la radique por ti?" respondieron "Radícala por mí ante la oficina
 *    judicial de Medellín" — el consentimiento más explícito posible— y una
 *    lista blanca de confirmaciones cortas lo leyó como un no. Por eso también
 *    se reconocen los IMPERATIVOS de la acción.
 */

function normalizar(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

/* Negaciones primero: "no, mejor no" y "no la radiques" tienen que ganarle a
 * cualquier palabra afirmativa que aparezca en la misma frase. */
const NEGACION = /(^|\s)(no|nop|nel|negativo|todavia no|aun no|mejor no|despues|luego|ahorita no|prefiero (llevarla|hacerlo)|yo (la|lo) (llevo|hago)|esta mal|equivocado|incorrecto|otra vez|repita|repitame)(\s|$|,|\.)/;

const AFIRMACION = /(^|\s)(si|sii|sip|claro|correcto|exacto|exactamente|asi es|esta bien|estabien|listo|dale|hagalo|hazlo|de una|por favor|porfa|obvio|perfecto|ok|okey|bueno|afirmativo|ya|adelante|proceda|procede)(\s|$|,|\.)/;

/* Los imperativos de la acción: quien dice "radícala" está consintiendo con
 * más claridad que quien dice "ok". */
const IMPERATIVO = /(^|\s)(radica|radicala|radiquela|radiquen|radicarla|envia|enviala|enviela|manda|mandala|mandela|presenta|presentala|preséntala|tramita|tramitala|hagalo|haganlo|procede|proceda)(\w*)?(\s|$|,|\.)/;

/** ¿Consintió? */
export function esAfirmativo(texto: string): boolean {
  const t = normalizar(texto);
  if (NEGACION.test(t)) return false;
  return AFIRMACION.test(t) || IMPERATIVO.test(t);
}

/** ¿Lo rechazó explícitamente? */
export function esNegativo(texto: string): boolean {
  const t = normalizar(texto);
  return NEGACION.test(t) && !IMPERATIVO.test(t);
}

/* ── El desempate ────────────────────────────────────────────────────────── */

export type Intencion = "si" | "no" | "ambiguo";

/**
 * Lee la respuesta a una pregunta de sí/no. Reglas primero, modelo después.
 *
 * POR QUÉ ESTE ORDEN Y NO SOLO EL MODELO:
 *
 *   · Las reglas deciden en 0 ms y son auditables. Radicar es IRREVERSIBLE
 *     —abre un proceso y deja notificada a la persona—, y en los casos claros
 *     prefiero algo que pueda demostrar con tests a algo que puede variar entre
 *     dos corridas sobre la misma frase.
 *   · Todo el bot degrada a reglas sin LLM. El consentimiento no puede ser la
 *     excepción: fallaría justo cuando ya está fallando lo demás.
 *
 * POR QUÉ NO SOLO REGLAS: porque no se puede enumerar cómo habla la gente. A
 * "¿quieres que la radique por ti?" respondieron "Radícala por mí ante la
 * oficina judicial de Medellín" y una lista blanca lo leyó como un no. El
 * modelo cubre justo lo que no se anticipó.
 *
 * Si el modelo no está o no contesta a tiempo, devuelve "ambiguo" — y quien
 * llama REPREGUNTA. Ante la duda sobre un acto irreversible se pregunta, no se
 * adivina.
 */
export async function interpretarSiNo(
  texto: string, pregunta: string, opts: { msMax?: number } = {},
): Promise<Intencion> {
  if (esAfirmativo(texto)) return "si";
  if (esNegativo(texto)) return "no";

  const { generarJSON, llmDisponible } = await import("@/lib/llm");
  if (!llmDisponible()) return "ambiguo";

  const prompt = `Alguien respondió a esta pregunta de sí o no en un chat de WhatsApp.

PREGUNTA: "${pregunta}"
RESPUESTA: "${texto}"

¿La persona está ACEPTANDO, RECHAZANDO, o no se sabe?

- "si" si acepta, aunque lo diga con otras palabras o dando la orden directa
  ("hágalo", "mándela ya", "eso sería genial").
- "no" si rechaza o lo posterga ("después", "yo me encargo", "déjame pensarlo").
- "ambiguo" si cambió de tema, hizo otra pregunta, o de verdad no se entiende.

Ante la duda responde "ambiguo": lo que se está decidiendo no se puede deshacer.

Responde SOLO: {"intencion": "si" | "no" | "ambiguo"}`;

  /* Reloj propio: esto puede correr dentro de un turno de llamada, donde Twilio
   * corta a los 15 s. Antes que una lectura perfecta que llega tarde, una
   * repregunta a tiempo. */
  const respuesta = await Promise.race([
    generarJSON<{ intencion?: string }>(prompt),
    new Promise<null>((r) => setTimeout(() => r(null), opts.msMax ?? 4000)),
  ]);

  const i = String(respuesta?.intencion ?? "").toLowerCase();
  return i === "si" || i === "no" ? i : "ambiguo";
}

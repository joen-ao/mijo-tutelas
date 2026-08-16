/**
 * T25 · Cómo SUENA el bot al escribir.
 *
 * Dos cosas que un asesor real hace y un bot no:
 *  1. No manda un ladrillo de texto: manda varias burbujas cortas seguidas.
 *  2. No decora cada frase con emojis ni arranca con "¡Claro! Con gusto...".
 *
 * `partirMensaje` hace lo primero y `humanizar` lo segundo. Van en el borde de
 * salida (justo antes de enviar), así aplican tanto si el texto lo escribió
 * Gemini como si vino de una frase fija — el prompt puede ignorarse, esto no.
 */

const EMOJI = /\p{Extended_Pictographic}(‍\p{Extended_Pictographic})*[️⃣]?/gu;

// Un emoji suelto al principio no debe blindar la muletilla que viene detrás
// ("¡Claro! 😊 Con gusto te ayudo" son DOS arranques encadenados).
const INICIO = String.raw`^[\s]*(?:\p{Extended_Pictographic}️?[\s]*)*`;
const arranque = (cuerpo: string) => new RegExp(INICIO + cuerpo, "iu");

/** Aperturas de asistente que delatan al bot al instante. */
const ARRANQUES_IA = [
  arranque(String.raw`¡?\s*(claro|por supuesto|perfecto|excelente|genial|entendido|listo)\s*[!,.]?\s*(que\s+bueno\s*[!,.]?)?\s*`),
  // Ojo: "Entiendo que buscas X" NO se borra. Suena a manual, pero la frase
  // lleva contenido (reconoce lo que dijo el cliente) y borrarla pierde el hilo.
  // De eso se encarga el prompt; aquí solo se quita lo que no aporta nada.
  arranque(String.raw`¡?\s*(excelente|muy buena)\s+pregunta\s*[!.]?\s*`),
  arranque(String.raw`como\s+(tu\s+)?(asistente|agente|bot|ia)[^.!?]*[.!?]\s*`),
  arranque(String.raw`(estoy\s+aqu[ií]\s+para\s+ayudarte|con\s+gusto\s+te\s+ayudo)\s*[!.]?\s*`),
];

/** Cierres de manual de servicio al cliente. */
const CIERRES_IA = [
  /\s*(¡?\s*)?espero\s+que\s+(esto|esta\s+informaci[oó]n)\s+te\s+(sea\s+[uú]til|ayude)\s*[!.]?\s*$/i,
  /\s*(no\s+dudes\s+en|si\s+tienes\s+(alguna\s+)?(otra\s+)?(duda|pregunta))[^.!?]*[.!?]\s*$/i,
  /\s*estoy\s+(aqu[ií]|a\s+tu\s+disposici[oó]n)[^.!?]*[.!?]\s*$/i,
];

/**
 * Baja el volumen: deja como máximo `maxEmojis` (por defecto 1) y quita las
 * muletillas de asistente. No toca URLs, montos ni el formato *negrita* de
 * WhatsApp.
 */
export function humanizar(texto: string, maxEmojis = 1): string {
  if (!texto) return texto;
  let t = texto;

  // Se repite: las muletillas vienen encadenadas ("¡Perfecto! Entiendo que...").
  for (let pasada = 0; pasada < 3; pasada++) {
    const antes = t;
    for (const re of ARRANQUES_IA) t = t.replace(re, "");
    for (const re of CIERRES_IA) t = t.replace(re, "");
    if (t === antes) break;
  }

  // La raya larga es marca de casa del LLM; en WhatsApp nadie la escribe.
  t = t.replace(/\s+—\s+/g, ", ").replace(/\s+–\s+/g, ", ");
  t = t.replace(/([!?])\1+/g, "$1");        // "!!!" → "!"
  t = t.replace(/[ \t]{2,}/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n");

  // Recorte de emojis: se conservan los primeros `maxEmojis`, el resto se va.
  let vistos = 0;
  t = t.replace(EMOJI, (m) => (++vistos <= maxEmojis ? m : ""));
  // Espacios que quedaron colgando donde había un emoji.
  t = t.replace(/[ \t]+([,.!?])/g, "$1").replace(/[ \t]{2,}/g, " ");
  t = t.split("\n").map((l) => l.trimEnd()).join("\n");

  return t.trim();
}

const MAX_BURBUJA = 300;   // caracteres por burbuja antes de partir
const MAX_BURBUJAS = 5;    // más que esto ya es spam, no conversación

const esLista = (l: string) => /^\s*([•\-*★▪]|\d+[.)])\s/.test(l);
const tieneUrl = (l: string) => /https?:\/\//.test(l);

/**
 * Parte un mensaje largo en burbujas cortas, como escribe una persona.
 *
 * Reglas: nunca corta una URL ni una lista (van completas en su burbuja), parte
 * primero por párrafos y solo dentro de un párrafo largo por frases, y si algo
 * queda demasiado partido lo vuelve a juntar (mejor 3 burbujas que 9).
 */
export function partirMensaje(texto: string, max = MAX_BURBUJA): string[] {
  const limpio = (texto ?? "").trim();
  if (!limpio) return [];

  // 1) Bloques: párrafos, pero las líneas de lista consecutivas van juntas.
  const bloques: string[] = [];
  let listaActual: string[] = [];
  const cerrarLista = () => {
    if (listaActual.length) { bloques.push(listaActual.join("\n")); listaActual = []; }
  };
  for (const parrafo of limpio.split(/\n{2,}/)) {
    const lineas = parrafo.split("\n");
    if (lineas.some(esLista)) {
      cerrarLista();
      bloques.push(parrafo);           // la lista entera, de una
      continue;
    }
    cerrarLista();
    bloques.push(parrafo);
  }
  cerrarLista();

  // 2) Un bloque largo (y sin lista ni URL) se parte por frases.
  const trozos: string[] = [];
  for (const b of bloques) {
    const bt = b.trim();
    if (!bt) continue;
    if (bt.length <= max || esLista(bt) || tieneUrl(bt)) { trozos.push(bt); continue; }

    const frases = bt.match(/[^.!?…]+[.!?…]+[\s]*|[^.!?…]+$/g) ?? [bt];
    let buf = "";
    for (const f of frases) {
      if (buf && (buf + f).trim().length > max) { trozos.push(buf.trim()); buf = f; }
      else buf += f;
    }
    if (buf.trim()) trozos.push(buf.trim());
  }

  // 3) Si quedaron demasiadas, se van fusionando las más cortas contiguas.
  const salida = trozos.filter(Boolean);
  while (salida.length > MAX_BURBUJAS) {
    let iMin = 0, lenMin = Infinity;
    for (let i = 0; i < salida.length - 1; i++) {
      const l = salida[i].length + salida[i + 1].length;
      // no fusionamos hacia una burbuja con URL o lista: se quieren solas
      if (tieneUrl(salida[i + 1]) || esLista(salida[i + 1])) continue;
      if (l < lenMin) { lenMin = l; iMin = i; }
    }
    if (lenMin === Infinity) break;
    salida.splice(iMin, 2, `${salida[iMin]}\n\n${salida[iMin + 1]}`);
  }
  return salida;
}

/**
 * "09:00" → "9 de la mañana". Las horas en formato HH:MM se oyen pésimo por voz
 * ("nueve cero cero") y tampoco se leen naturales en un chat.
 */
function partesHora(hhmm: string): { reloj: string; franja: string } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const franja = h === 12 ? "del mediodía"
    : h === 0 ? "de la noche"
    : h < 12 ? "de la mañana"
    : h < 19 ? "de la tarde" : "de la noche";
  return { reloj: min ? `${h12} y ${min}` : `${h12}`, franja };
}

export function horaLegible(hhmm: string): string {
  const p = partesHora(hhmm);
  return p ? `${p.reloj} ${p.franja}` : hhmm;
}

/** En español "o" se vuelve "u" delante de palabra que empieza por sonido /o/. */
function unir(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  const ultimo = items[items.length - 1];
  const conector = /^(11|8|once|ocho|o|ho)/i.test(ultimo) ? "u" : "o";
  return `${items.slice(0, -1).join(", ")} ${conector} ${ultimo}`;
}

/**
 * Lista de horas como la diría una persona. Si todas caen en la misma franja,
 * se dice una sola vez ("9, 10 u 11 de la mañana") en vez de repetirla en cada
 * hora, que es justo lo que sonaba a robot.
 */
export function horasLegibles(horas: string[]): string {
  const partes = horas.map(partesHora).filter((p): p is NonNullable<typeof p> => p !== null);
  if (!partes.length) return "";
  const franjas = new Set(partes.map((p) => p.franja));
  if (franjas.size === 1) {
    return `${unir(partes.map((p) => p.reloj))} ${partes[0].franja}`;
  }
  return unir(partes.map((p) => `${p.reloj} ${p.franja}`));
}

/**
 * Normaliza el texto ANTES de mandarlo al TTS. Es la red de seguridad: aunque
 * un mensaje traiga "09:00" desde cualquier parte del código, por voz se oirá
 * "9 de la mañana" y no "cero nueve dos puntos cero cero".
 */
export function paraVoz(texto: string): string {
  return texto
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h, m) => horaLegible(`${h}:${m}`))
    .replace(/\bm²\b/g, "metros cuadrados")
    .replace(/\bSMLV\b/g, "salarios mínimos");
}

// --- ¿Le escribimos o le mandamos notas de voz? (se pregunta en el saludo) ---

export const PREGUNTA_MEDIO = "Ah, y una cosa: ¿prefieres que te escriba o que te mande notas de voz?";

/** Sin tildes y en minúscula: "escríbeme" no empieza por "escrib", y `\b` se
 *  comporta raro junto a una vocal acentuada ("por aquí" no casaba). */
const sinTildes = (s: string) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Lee en la respuesta si quiere audio o texto. `null` = no lo dijo o dijo ambos. */
export function detectarMedio(texto: string): "audio" | "texto" | null {
  const t = sinTildes(texto);
  const audio = /\b(audio|audios|voz|voces|hablado|hablada|escuchar|oir|oyendo)\b/.test(t);
  const escrito = /\b(texto|escrito|escrita|escrib\w*|escrib|leer|leyendo|lectura|chat|mensaje|mensajes|por aqui|por aca)\b/.test(t);
  if (audio && !escrito) return "audio";
  if (escrito && !audio) return "texto";
  return null;
}

/**
 * ¿El mensaje fue SOLO para elegir el medio? Importa porque si no, "audio"
 * quedaría guardado como si fuera la respuesta a la pregunta que estaba pendiente.
 */
export function soloEligioMedio(texto: string): boolean {
  return (texto ?? "").trim().split(/\s+/).filter(Boolean).length <= 4;
}

/**
 * Cuánto esperar antes de soltar la siguiente burbuja. Aproxima el tiempo real
 * de tecleo (con tope) para que la ráfaga se sienta escrita, no disparada.
 */
export function pausaDeTecleo(texto: string): number {
  return Math.min(2600, 450 + texto.length * 14);
}

export const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Mijo por teléfono: le lee la tutela a la persona en voz alta.
 *
 * POR QUÉ EXISTE. El producto entrega un PDF por WhatsApp, y eso deja afuera
 * justo a quien más lo necesita: el adulto mayor que no lee bien, que no sabe
 * abrir un adjunto, que tiene el teléfono lleno y no le entran archivos. Esa
 * persona es exactamente la que lleva ocho meses peleando con la EPS. Una
 * llamada no le pide que sepa nada: suena, contesta, y le dicen qué hacer.
 *
 * POR QUÉ NO ES EL MISMO TEXTO DE WHATSAPP. Por teléfono no se puede releer.
 * Un mensaje escrito puede meter tres datos en una frase porque el ojo vuelve;
 * al oído eso se pierde entero. Así que el guion va más lento, dice una cosa por
 * frase, y repite lo único que la persona TIENE que retener: a dónde ir y que no
 * necesita abogado.
 *
 * NO TOCA WHATSAPP. Es otro número (TWILIO_VOICE_FROM, con capacidad de voz) y
 * otra API de Twilio. La cuota diaria del sandbox de WhatsApp no se ve afectada:
 * una llamada no gasta un mensaje.
 *
 * El TwiML va EN LÍNEA en el POST (ver lib/twilioCall.ts), así que esto funciona
 * sin exponer un webhook público — no depende de ngrok.
 */
import { llamadasListas, llamarConVoz } from "@/lib/twilioCall";
import { enumerar, frasePedido, type Tutela } from "@/lib/tutela";

export { llamadasListas };

/**
 * El guion de la llamada.
 *
 * Sin markdown, sin emojis, sin URLs: todo eso se lee en voz alta y suena a
 * robot. Las pausas se marcan con puntos, que es lo que el TTS respeta.
 */
export function guionLlamada(doc: Tutela, opts: { oficina?: string | null } = {}): string {
  const eps = doc.accionado.nombre || "tu EPS";
  const ciudad = doc.accionante.ciudad || "tu ciudad";
  const nombre = (doc.accionante.nombre || "").split(/\s+/)[0] || "";
  const l: string[] = [];

  l.push(`Hola${nombre ? " " + nombre : ""}. Te llama Mijo.`);
  l.push(`Ya está lista tu acción de tutela contra ${eps}.`);
  l.push(`Te la mandé al WhatsApp en un archivo, pero te la explico por aquí, con calma.`);

  l.push(`El documento le cuenta al juez lo que te pasó, en ${doc.hechos.length} puntos, `
    + `y le pide que ordene entregarte ${frasePedido(doc.que_negaron) || "lo que te negaron"}.`);

  if (doc.medida_provisional) {
    l.push("Tu caso es urgente, así que además le pedí al juez que resuelva de inmediato, "
      + "sin esperar los diez días. Eso se llama medida provisional.");
  }

  l.push("Ahora, lo que tienes que hacer.");
  l.push("Primero. Imprime dos copias del documento y fírmalas a mano.");
  l.push(`Segundo. Llévalas a cualquier juzgado de ${ciudad}. `
    + (opts.oficina ? `Te corresponde la ${opts.oficina}. ` : "")
    + "Preguntas por la oficina de reparto. Cualquier juzgado sirve.");
  l.push("Tercero. Entregas una copia y te devuelven la otra sellada. Esa sellada guárdala, "
    + "es tu comprobante.");

  /* Se repite al final a propósito. Es lo único que no puede perderse, y es
   * justo lo que más gente no sabe: que no necesita abogado ni pagar nada. */
  l.push("Y escúchame esto, que es importante.");
  l.push("No necesitas abogado. La ley dice que puedes hacerlo tú mismo.");
  l.push("Y no te cuesta nada. Si alguien te cobra por recibirte la tutela, no es legal.");
  l.push("El juez tiene diez días para responderte.");
  l.push("En unos días te escribo al WhatsApp para saber cómo te fue. Hasta luego.");

  return l.join(" ");
}

export interface ResultadoLlamada {
  ok: boolean;
  callSid?: string;
  voz?: "elevenlabs" | "twilio";
  error?: string;
}

/**
 * Llama y lee la tutela. Best-effort, como todo lo que acompaña al documento:
 * si la llamada falla, la persona YA tiene su PDF y su nota de voz. Que el
 * teléfono no entre no puede costarle la tutela.
 *
 * `telefono` puede venir en formato de WhatsApp ("whatsapp:+57…"); se limpia
 * aquí para no obligar a quien llama a acordarse.
 */
export async function llamarYLeerTutela(
  telefono: string, doc: Tutela, opts: { oficina?: string | null } = {},
): Promise<ResultadoLlamada> {
  if (!llamadasListas()) {
    return { ok: false, error: "faltan TWILIO_VOICE_FROM o las credenciales de Twilio" };
  }
  const to = telefono.replace(/^whatsapp:/, "").trim();
  return llamarConVoz(to, guionLlamada(doc, opts), { ciudad: doc.accionante.ciudad });
}

/**
 * Detecta que la persona está pidiendo que la llamen.
 *
 * Por reglas y no por LLM: es una intención de tres palabras, y meterle una
 * llamada al modelo para esto sería pagar dos segundos de latencia por algo que
 * una expresión regular resuelve. Además tiene que funcionar aunque Gemini esté
 * caído, que es cuando más falta hace poder hablar con alguien.
 */
export function pideLlamada(texto: string): boolean {
  const t = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\b(llamame|llamenme|me pueden llamar|puedes llamarme|quiero que me llamen|prefiero por telefono|no se leer|no veo bien|no entiendo el archivo|no puedo abrir)\b/.test(t);
}

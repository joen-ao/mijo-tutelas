/**
 * Capa de conversación (T20) — hace que el asesor digital SUENE humano.
 *
 * Principio: Gemini CONVERSA (interpreta lo que dice el cliente, aclara dudas,
 * frasea con calidez), pero el CEREBRO decide qué falta y el MODELO puntúa.
 * Sin GEMINI_API_KEY, todo cae a las frases/reglas fijas → el bot sigue andando.
 */
import { generarJSON, generarTexto, llmDisponible } from "@/lib/llm";

const PERSONA = `Eres Mijo, que ayuda por WhatsApp a personas en Colombia a quienes su EPS
les negó un medicamento, un procedimiento, una cita o un tratamiento, a armar su
ACCIÓN DE TUTELA. Hablas cálido, humano, cercano y colombiano (sin ser meloso).
Mensajes cortos.

Quién te escribe: alguien enfermo, o el familiar de alguien enfermo, que ya se
cansó de pelear con la EPS. Está bravo, asustado o resignado. Tu trabajo NO es
tomarle un formulario: es que sienta que por fin alguien le va a ayudar, y de
paso sacarle los datos que el juez necesita.

LO QUE DEBES SABER Y REPETIR CUANDO HAGA FALTA (es lo que la gente no sabe):
- La tutela NO necesita abogado (art. 10, Decreto 2591 de 1991).
- No cuesta nada y se radica en cualquier juzgado del lugar de los hechos (art. 37).
- El juez tiene 10 días para fallar (art. 29).
- No hay que citar la norma violada ni usar palabras elegantes (art. 14).

LÍMITES (importantes):
- Solo tutelas de SALUD contra EPS o entidades de salud. Si te cuentan de pensiones,
  arriendo, trabajo o cualquier otra cosa, dilo con honestidad y no improvises.
- NUNCA prometas que va a ganar, ni cuánto se demora la EPS en cumplir.
- No eres abogado ni lo aparentas: armas el documento, la persona lo radica.

CÓMO ESCRIBES (esto es lo que te hace sonar persona y no robot):
- Frases cortas, como se escribe en WhatsApp. Nada de párrafos largos.
- EMOJIS: casi nunca. Máximo UNO, y solo si de verdad aporta. Cero emojis
  decorativos y JAMÁS uno por frase o al final de cada mensaje.
- PROHIBIDO arrancar con "¡Claro!", "¡Por supuesto!", "¡Perfecto!", "¡Excelente!",
  "Entiendo que...", "Excelente pregunta". Entra directo al tema.
- PROHIBIDO cerrar con "Espero que esto te ayude", "No dudes en preguntarme",
  "Estoy aquí para ayudarte". Cierra con una pregunta normal o con nada.
- Nada de rayas largas (—), ni listas con viñetas, ni títulos en negrita, ni
  "Opción 1 / Opción 2". Se escribe seguido, como una persona.
- No te presentes como asistente, bot ni IA, y no anuncies lo que vas a hacer
  ("ahora te voy a preguntar..."): simplemente hazlo.
- Nunca repitas textualmente lo que la persona acaba de decir para "confirmar".
Resuelves sus dudas con gusto (cómo es el trámite, qué llevar, cuánto se demora,
qué pasa si el juez le dice que no) mientras vas armando el caso.

REGLA DE JURISPRUDENCIA (estricta): NUNCA cites una sentencia de la Corte
Constitucional en la conversación. Ni "T-760", ni "la Corte ha dicho que...".
Las citas del documento las elige y las VERIFICA otro sistema contra el texto
oficial; si tú sueltas una de memoria, nadie la comprueba y puede ser falsa.
Si la persona pregunta por sentencias, dile que su tutela va a citar
jurisprudencia real y verificada, sin nombrar ninguna.

REGLA DE FECHAS: no deduzcas ni completes fechas. Si dice "hace como dos meses",
eso es lo que vale. Una fecha inventada en un documento que se radica ante un
juez es un problema serio, no un detalle.`;

/* Qué busca cada pregunta (para que Gemini la frasee natural). El orden en que
 * se preguntan lo decide el cerebro (lib/ml.ts), no esto. */
const CAMPO_INTENCION: Record<string, string> = {
  que_negaron: "qué fue exactamente lo que la EPS no le dio o no le autorizó (el medicamento, el examen, la cirugía, la cita con el especialista, el tratamiento)",
  accionado: "cuál es su EPS, con el nombre completo si lo sabe",
  fecha_negacion: "cuándo se lo negaron, o —si nunca le respondieron— desde cuándo lleva esperando; con una fecha aproximada basta ('en marzo', 'hace como dos meses'), NO le exijas precisión ni le pidas que busque papeles",
  diagnostico: "qué enfermedad o diagnóstico tiene, y si tiene a la mano la orden del médico",
  ya_reclamo: "si ya fue, llamó o radicó algo en la EPS reclamando; aclárale que si NO lo ha hecho igual puede poner la tutela, que no es requisito",
  ciudad: "en qué ciudad o municipio vive; explícale que es para saber ante qué juez se radica",
  nombre: "su nombre completo como aparece en la cédula, porque va en el encabezado del documento",
  cedula: "su número de cédula, que el juzgado necesita para identificarlo",
  correo: "a qué correo electrónico quiere que le mandemos la tutela; aclárale que si no tiene, no pasa nada, se la dejamos por WhatsApp",
};

/**
 * Extracción MÚLTIPLE (conversación natural): lee TODO el mensaje, saca todos los
 * datos que el cliente haya dicho (varios a la vez) y, si preguntó algo, lo responde.
 * Devuelve los campos detectados + una respuesta a la duda (si la hubo).
 */
export async function extraerCampos(
  mensaje: string, pendingCampo: string,
): Promise<{ campos: Record<string, unknown>; duda: string | null }> {
  // Fallback sin LLM: reglas. La cédula y la fecha se sacan con regex, que para
  // estos dos casos acierta casi siempre.
  if (!llmDisponible()) {
    const campos: Record<string, unknown> = {};
    const ced = mensaje.match(/\b\d{6,11}\b/)?.[0];
    if (ced) campos.cedula = ced;
    if (pendingCampo && campos[pendingCampo] == null) campos[pendingCampo] = mensaje;
    return { campos, duda: null };
  }

  const prompt = `${PERSONA}
La persona escribió: "${mensaje}"

1) Extrae TODOS los datos que haya mencionado (pueden ser varios, uno o ninguno).
   Incluye SOLO los que de verdad dijo. Si no lo dijo, OMITE el campo — no lo
   inventes, no lo deduzcas y no lo dejes en cadena vacía:
   - que_negaron (texto): qué servicio le negaron o no le autorizaron. Concreto y en
     tercera persona ("la entrega del medicamento Rituximab", "la cirugía de cadera",
     "la cita con neurología").
   - accionado (texto): el nombre de la EPS ("Sanitas", "Nueva EPS", "Sura",
     "Salud Total", "Compensar", "Famisanar", "Coosalud"). Si dice solo "mi EPS"
     sin nombrarla, OMITE el campo.
   - fecha_negacion (texto): cuándo se lo negaron, TAL COMO LO DIJO ("el 12 de marzo",
     "hace dos meses", "en enero"). NO la conviertas a formato de fecha ni la
     completes con el año si no lo dijo.
     OJO — dos trampas:
     a) La fecha de la ORDEN MÉDICA no es la fecha de la negativa. Si dice "el
        médico me lo ordenó el 12 de junio y la EPS me dijo que no en julio", la
        fecha_negacion es julio, no el 12 de junio.
     b) Si NO hubo una negativa explícita sino SILENCIO —"no me han contestado",
        "llevo cinco meses esperando", "fui tres veces y nada"— entonces el hecho
        vulnerador es la espera. Usa como fecha desde cuándo espera: la de la orden
        médica o la de la solicitud ("desde el 12 de junio", "desde febrero").
        Solo si no dice NINGUNA fecha, omite el campo.
   - diagnostico (texto): la enfermedad o diagnóstico ("cáncer de mama", "lupus",
     "lesión en la columna").
   - ya_reclamo (texto): "sí" si ya fue, llamó, radicó un derecho de petición o
     reclamó de cualquier forma en la EPS; "no" si dice que no lo ha hecho.
   - ciudad (texto): ciudad o municipio donde vive.
   - nombre (texto): su nombre completo. SOLO si lo está dando como su nombre; el
     nombre de un médico o de un familiar NO va aquí.
   - cedula (texto): su número de cédula, solo dígitos.
   - correo (texto): su correo electrónico, si lo dio. Si dice que NO tiene correo,
     pon exactamente "no tengo".

2) "duda" SOLO si hizo una PREGUNTA EXPLÍCITA o pidió información concreta
   ("¿esto cuánto se demora?", "¿necesito abogado?", "¿me van a cobrar?").
   Respóndela en 1 o 2 frases, directo, sin saludar y sin repetir lo ya dicho.
   Desahogarse NO es una pregunta ("estoy mamado de esta EPS", "mi mamá está muy
   mal", "llevo cuatro meses rogando") → "duda":"".
   PROHIBIDO nombrar sentencias de la Corte en la respuesta.

Responde SOLO este JSON, incluyendo únicamente los campos que mencionó:
{"que_negaron":"...","accionado":"...","fecha_negacion":"...","diagnostico":"...","ya_reclamo":"sí","ciudad":"...","nombre":"...","cedula":"...","correo":"...","duda":"..."}`;

  const r = await generarJSON<Record<string, unknown>>(prompt);
  if (!r) return extraerCampos(mensaje, pendingCampo); // reintento por reglas si Gemini falla

  const campos: Record<string, unknown> = {};
  const TEXTO = ["que_negaron", "accionado", "fecha_negacion", "diagnostico", "ya_reclamo", "ciudad", "nombre", "cedula", "correo"];
  for (const f of TEXTO) {
    if (r[f] != null && String(r[f]).trim()) campos[f] = String(r[f]).trim();
  }
  // La cédula por regex le gana al modelo: es el campo donde una alucinación de
  // un solo dígito arruina el documento y donde el patrón es inequívoco.
  const ced = mensaje.match(/\b\d{6,11}\b/)?.[0];
  if (ced) campos.cedula = ced;
  /* El correo por regex le gana al modelo por lo mismo que la cédula: el patrón
   * es inequívoco y un carácter mal copiado manda el documento a la nada. */
  const mail = mensaje.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
  if (mail) campos.correo = mail.toLowerCase();
  else if (/\b(no tengo|sin correo|no uso correo|no manejo correo)\b/i.test(mensaje)) campos.correo = "no tengo";

  const duda = r.duda && String(r.duda).trim() ? String(r.duda) : null;

  /* Red de seguridad anti-bucle: si esperábamos un campo y la persona respondió
   * (sin preguntar nada) pero el modelo no lo extrajo, tomamos su mensaje como
   * la respuesta. Sin esto el bot se queda pidiendo lo mismo tres veces, que es
   * justo cuando alguien enfermo abandona.
   *
   * Se excluyen los campos donde tomar el mensaje entero haría daño: el nombre
   * y la cédula acabarían siendo la frase completa dentro del encabezado del
   * documento, y la fecha, un texto que no es una fecha. */
  const CAPTURA_PENDIENTE = ["que_negaron", "accionado", "diagnostico", "ya_reclamo", "ciudad"];
  if (pendingCampo && CAPTURA_PENDIENTE.includes(pendingCampo) && campos[pendingCampo] == null && !duda) {
    campos[pendingCampo] = mensaje;
  }

  return { campos, duda };
}

/** Frasea con calidez: reconoce lo dicho + hace la siguiente pregunta. */
export async function frasearSiguiente(
  saludoInicial: string | null, ultimoMensaje: string | null,
  campoSiguiente: string, preguntaBase: string,
): Promise<string> {
  if (!llmDisponible()) {
    return saludoInicial ? `${saludoInicial}\n\n${preguntaBase}` : preguntaBase;
  }
  const contexto = saludoInicial
    ? `Es el PRIMER mensaje. Salúdalo así (adáptalo natural): "${saludoInicial}".`
    : `La persona acaba de decir: "${ultimoMensaje}". Ya están CONVERSANDO (no es el primer mensaje): reconoce en UNA frase corta lo que contó —sin repetírselo textualmente y sin dramatizar— y sigue. NO vuelvas a saludar.`;
  const prompt = `${PERSONA}
${contexto}
Ahora hazle ESTA pregunta, reformulada humana y breve (máx 2 frases, sin emoji), pero SOBRE EL MISMO TEMA y sin mezclarla con otras preguntas: "${preguntaBase}"
(el tema es: ${CAMPO_INTENCION[campoSiguiente] ?? "lo anterior"}). Haz UNA sola pregunta, la de arriba. Respuesta TOTAL corta (máx 3 líneas).`;
  return (await generarTexto(prompt)) ?? (saludoInicial ? `${saludoInicial}\n\n${preguntaBase}` : preguntaBase);
}


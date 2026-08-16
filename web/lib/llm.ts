/**
 * Capa LLM agnóstica al proveedor.
 *
 * Proveedor por defecto: Gemini (Google AI Studio). La interfaz no cambia si se
 * cambia de proveedor. PRINCIPIO: el LLM conversa e interpreta; NUNCA decide si
 * la tutela procede (eso es el motor de reglas) ni si una cita es real (eso es
 * el verificador).
 *
 * Sin GEMINI_API_KEY degrada a reglas y regex → el bot sigue funcionando, solo
 * con lenguaje menos flexible.
 */

const PROVIDER = process.env.LLM_PROVIDER ?? "gemini";
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

export function llmDisponible(): boolean {
  return PROVIDER === "gemini" && Boolean(GEMINI_KEY);
}

/** Genera texto natural (p. ej. reformular una pregunta). Devuelve null si no hay LLM. */
export async function generarTexto(prompt: string, json = false): Promise<string | null> {
  if (!llmDisponible()) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
    const body: Record<string, unknown> = { contents: [{ parts: [{ text: prompt }] }] };
    if (json) body.generationConfig = { responseMimeType: "application/json" };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

/** Genera y parsea JSON con Gemini. Devuelve null si no hay LLM o no parsea. */
export async function generarJSON<T = Record<string, unknown>>(prompt: string): Promise<T | null> {
  const txt = await generarTexto(prompt, true);
  if (!txt) return null;
  try {
    return JSON.parse(txt.replace(/```json|```/g, "").trim()) as T;
  } catch {
    return null;
  }
}



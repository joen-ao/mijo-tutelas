/**
 * Data-layer de Mijo — Supabase o memoria.
 *
 * Un CASO es una conversación de WhatsApp que va camino de convertirse en una
 * tutela: el teléfono de quien escribe, lo que ha ido contando y el veredicto
 * del motor de reglas sobre si el caso procede.
 *
 * Si Supabase está configurado (URL + key), los casos persisten entre
 * reinicios; si no, viven en memoria y la app funciona igual. La interfaz
 * (async) no cambia, así que quien llama no se entera.
 *
 * Ojo con lo que persiste y lo que no: el caso sobrevive a un reinicio, pero el
 * mapa de sesiones del webhook vive en memoria, así que tras reiniciar la
 * persona igual arranca de cero. Persistir la sesión es trabajo de otro día.
 */
import { randomUUID } from "node:crypto";

import { getSupabase } from "@/lib/supabase";
import type { Caso, Respuestas } from "@/lib/types";

/* Casos en memoria (modo local; sobreviven al HMR gracias a globalThis). */
const g = globalThis as unknown as { __casos?: Map<string, Caso> };
const casos: Map<string, Caso> = g.__casos ?? (g.__casos = new Map());

const TABLA = "casos";

export async function createLead(input: {
  canal: string; nombre: string | null; telefono: string | null;
  email: string | null; cedula: string | null; consentimiento: boolean;
}): Promise<Caso> {
  const caso: Caso = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    canal: input.canal,
    nombre: input.nombre,
    telefono: input.telefono,
    cedula: input.cedula,
    consentimiento: input.consentimiento,
    respuestas: {},
    score: null,
    probabilidad: null,
    ruteo: null,
    destino: null,
    reglas: [],
    estado_flujo: "nuevo",
  };

  const sb = getSupabase();
  if (sb) {
    const { error } = await sb.from(TABLA).insert(caso);
    if (error) throw new Error(`Supabase insert caso: ${error.message}`);
  } else {
    casos.set(caso.id, caso);
  }
  return caso;
}

export async function getLead(id: string): Promise<Caso | undefined> {
  const sb = getSupabase();
  if (sb) {
    const { data } = await sb.from(TABLA).select("*").eq("id", id).maybeSingle();
    return (data as Caso) ?? undefined;
  }
  return casos.get(id);
}

export async function updateLead(id: string, patch: Partial<Caso>): Promise<Caso | undefined> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from(TABLA).update(patch).eq("id", id).select().maybeSingle();
    if (error) throw new Error(`Supabase update caso: ${error.message}`);
    return (data as Caso) ?? undefined;
  }
  const cur = casos.get(id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch };
  casos.set(id, next);
  return next;
}

/** Las respuestas acumuladas de un caso (lo que la persona ya contó). */
export function respuestasDe(caso: Caso | undefined): Respuestas {
  return caso?.respuestas ?? {};
}

/**
 * Seguimiento de lo radicado — y el incidente de desacato.
 *
 * Este archivo existe por el hueco más grande del acceso a la justicia en
 * Colombia: la gente gana la tutela y no pasa nada. El juez ordena, la EPS no
 * cumple, y la persona —que ya hizo lo difícil— se queda esperando porque nadie
 * le dijo que ganar no basta. El artículo 52 del Decreto 2591 de 1991 le da un
 * incidente de desacato que es gratis, va ante el MISMO juez y puede terminar en
 * arresto y multa para el representante legal. Casi nadie lo sabe.
 *
 * Un bot de WhatsApp puede hacer algo que un abogado no hace: acordarse. A los
 * 10 días hábiles pregunta. Eso es todo, y es justo lo que falta.
 *
 * DEGRADACIÓN: si Supabase no está configurado, los seguimientos viven en
 * memoria y se pierden al reiniciar. Es peor, pero no rompe nada: agendar un
 * recordatorio nunca puede costarle a alguien su documento.
 */
import { randomUUID } from "node:crypto";

import { sumarDiasHabiles } from "@/lib/peticion";
import { getSupabase } from "@/lib/supabase";

export type TipoSeguimiento = "tutela" | "peticion";
export type EstadoSeguimiento = "pendiente" | "avisado" | "respondido" | "cerrado";

export interface Seguimiento {
  id: string;
  created_at: string;
  caso_id: string | null;
  telefono: string;
  tipo: TipoSeguimiento;
  ciudad: string | null;
  accionado: string | null;
  fecha_radicacion: string | null;
  fecha_seguimiento: string | null;
  estado: EstadoSeguimiento;
  respuesta: string | null;
  avisado_at: string | null;
}

const TABLA = "seguimientos";

/* Respaldo en memoria (sobrevive al HMR, no al reinicio). */
const g = globalThis as unknown as { __seguimientos?: Map<string, Seguimiento> };
const memoria: Map<string, Seguimiento> = g.__seguimientos ?? (g.__seguimientos = new Map());

/**
 * Días HÁBILES del fallo de tutela.
 *
 * Art. 29 del Decreto 2591 de 1991: el fallo se profiere «dentro de los diez
 * días siguientes a la presentación de la solicitud». Se cuentan hábiles por el
 * art. 62 de la Ley 4 de 1913, que suprime feriados y vacantes en los plazos de
 * días que fijan las leyes salvo que se diga lo contrario.
 *
 * Se le suma un día de gracia antes de escribir: preguntar el mismo día en que
 * vence, cuando el juzgado todavía puede estar notificando, genera una alarma
 * falsa y desgasta la confianza en el aviso.
 */
export const DIAS_FALLO_TUTELA = 10;

export function fechaDeSeguimiento(desdeIso: string, tipo: TipoSeguimiento, diasPeticion = 15): Date {
  const dias = tipo === "tutela" ? DIAS_FALLO_TUTELA : diasPeticion;
  return sumarDiasHabiles(desdeIso, dias + 1);
}

/**
 * Agenda el seguimiento. Best-effort a propósito: si la tabla no existe todavía
 * (falta correr la migración 0004) esto NO puede tumbar la radicación, que es
 * lo que de verdad le importa a la persona. Se avisa por consola y se sigue.
 */
export async function agendarSeguimiento(params: {
  casoId?: string | null;
  telefono: string;
  tipo: TipoSeguimiento;
  ciudad?: string | null;
  accionado?: string | null;
  diasPeticion?: number;
}): Promise<Seguimiento | null> {
  const ahora = new Date().toISOString();
  const s: Seguimiento = {
    id: randomUUID(),
    created_at: ahora,
    caso_id: params.casoId ?? null,
    telefono: params.telefono,
    tipo: params.tipo,
    ciudad: params.ciudad ?? null,
    accionado: params.accionado ?? null,
    fecha_radicacion: ahora,
    fecha_seguimiento: fechaDeSeguimiento(ahora, params.tipo, params.diasPeticion).toISOString(),
    estado: "pendiente",
    respuesta: null,
    avisado_at: null,
  };

  const sb = getSupabase();
  if (sb) {
    const { error } = await sb.from(TABLA).insert(s);
    if (error) {
      console.warn(`[seguimiento] no se pudo agendar en Supabase (${error.message}). `
        + "¿Falta correr web/supabase/migrations/0004_seguimientos.sql? Queda en memoria.");
      memoria.set(s.id, s);
    }
  } else {
    memoria.set(s.id, s);
  }
  console.log(`[seguimiento] agendado ${s.tipo} para ${s.telefono} → ${s.fecha_seguimiento?.slice(0, 10)}`);
  return s;
}

/** Los que ya vencieron y todavía no se han avisado. */
export async function seguimientosVencidos(limite = 50): Promise<Seguimiento[]> {
  const ahora = new Date().toISOString();
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from(TABLA).select("*")
      .eq("estado", "pendiente").lte("fecha_seguimiento", ahora).limit(limite);
    if (!error && data) return data as Seguimiento[];
    if (error) console.warn("[seguimiento] lectura falló:", error.message);
  }
  return [...memoria.values()]
    .filter((s) => s.estado === "pendiente" && (s.fecha_seguimiento ?? "") <= ahora)
    .slice(0, limite);
}

/** El seguimiento vivo más reciente de un teléfono (para leer su respuesta). */
export async function seguimientoDe(telefono: string): Promise<Seguimiento | null> {
  const sb = getSupabase();
  if (sb) {
    const { data } = await sb.from(TABLA).select("*")
      .eq("telefono", telefono).in("estado", ["avisado", "pendiente"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data) return data as Seguimiento;
  }
  const propios = [...memoria.values()]
    .filter((s) => s.telefono === telefono && (s.estado === "avisado" || s.estado === "pendiente"))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return propios[0] ?? null;
}

export async function marcarSeguimiento(
  id: string, patch: Partial<Seguimiento>,
): Promise<void> {
  const sb = getSupabase();
  if (sb) {
    const { error } = await sb.from(TABLA).update(patch).eq("id", id);
    if (!error) return;
    console.warn("[seguimiento] update falló:", error.message);
  }
  const cur = memoria.get(id);
  if (cur) memoria.set(id, { ...cur, ...patch });
}

/* ── Los textos ──────────────────────────────────────────────────────────── */

/** El mensaje que se manda al vencerse el término. */
export function mensajeDeSeguimiento(s: Seguimiento): string {
  const quien = s.accionado || "tu EPS";
  if (s.tipo === "peticion") {
    return `Hola, soy Mijo. Hace ${s.tipo === "peticion" ? "unos días" : "10 días"} radicamos tu derecho de petición `
      + `contra ${quien} y ya se venció el plazo que tenía para responderte.\n\n`
      + "¿Te respondieron algo? Contame *sí* o *no*.";
  }
  return `Hola, soy Mijo. Hace 10 días hábiles radicamos tu acción de tutela contra ${quien}, `
    + "que es el plazo que tiene el juez para fallar (artículo 29 del Decreto 2591 de 1991).\n\n"
    + "¿Ya te respondieron? Contame con tus palabras — por ejemplo:\n"
    + "· *me la concedieron pero la EPS no ha cumplido*\n"
    + "· *no me han respondido nada*\n"
    + "· *ya me dieron lo que pedía*";
}

/** Qué contestó la persona al aviso. */
export type Desenlace = "gano_sin_cumplir" | "sin_respuesta" | "cumplido" | "perdio" | "no_claro";

/**
 * Lee la respuesta al seguimiento.
 *
 * Va por reglas y no por LLM porque son cuatro desenlaces y las palabras que
 * usa la gente son muy estables. Y porque de esto depende qué escrito se le
 * ofrece: equivocarse aquí manda a alguien a un desacato cuando lo que necesita
 * es una impugnación, que tiene 3 días de plazo y se le vence.
 */
export function leerDesenlace(texto: string): Desenlace {
  const t = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const concedida = /\b(conced|tutelar|gan|me la dieron|fallo a mi favor|a mi favor|me dieron la razon)/.test(t);
  const incumple = /\b(no (han |ha )?cumpl|no me (han |ha )?(dado|entregado|autorizado)|sigue igual|no pasa nada|siguen sin|incumpl)/.test(t);
  const sinRespuesta = /\b(no (me )?(han |ha )?(respond|contest|dicho|llegado)|nada|ninguna respuesta|sin respuesta|no se nada)/.test(t);
  const cumplido = /\b(ya me (dieron|entregaron|autorizaron)|cumpli|me lo dieron|ya me atendieron|todo bien|se soluciono)/.test(t);
  const perdio = /\b(neg(aron|o)|no me la (dieron|concedieron)|perd[ií]|fallo en contra|improcedente)/.test(t);

  if (cumplido && !incumple) return "cumplido";
  if (concedida && incumple) return "gano_sin_cumplir";
  if (incumple) return "gano_sin_cumplir";
  if (perdio) return "perdio";
  if (sinRespuesta) return "sin_respuesta";
  if (concedida) return "cumplido";
  return "no_claro";
}

/**
 * Qué se le explica según lo que pasó.
 *
 * Cada rama termina en algo CONCRETO que la persona puede hacer mañana, no en
 * un "consulta a un abogado". Ese es el punto entero de esto.
 */
export function respuestaAlDesenlace(d: Desenlace, s: Seguimiento): string {
  const quien = s.accionado || "la EPS";

  if (d === "gano_sin_cumplir") {
    return "Ganaste y no están cumpliendo. Eso tiene nombre y tiene remedio: se llama "
      + "*INCIDENTE DE DESACATO* (artículo 52 del Decreto 2591 de 1991).\n\n"
      + "Tres cosas que debes saber:\n\n"
      + "1️⃣ Se presenta ante *el MISMO juez* que falló tu tutela. No empiezas de cero ni "
      + "buscas otro juzgado.\n\n"
      + "2️⃣ Es *gratis* y tampoco necesitas abogado.\n\n"
      + `3️⃣ El juez puede sancionar al representante legal de ${quien} con *arresto de hasta 6 meses y multa*. `
      + "Por eso funciona: la sanción es personal, no de la empresa.\n\n"
      + "¿Quieres que te prepare el escrito del desacato? Respóndeme *sí*.";
  }

  if (d === "sin_respuesta") {
    return "El plazo ya se venció y eso no es normal: los 10 días del artículo 29 son "
      + "obligatorios para el juez.\n\n"
      + "Lo que puedes hacer ahora:\n\n"
      + "1️⃣ Pide un *informe del estado del proceso* al juzgado donde radicaste, con tu "
      + "número de radicado. Basta un correo o ir a la ventanilla.\n\n"
      + "2️⃣ Si te dan largas, puedes poner una queja ante el *Consejo Seccional de la "
      + "Judicatura*: la demora injustificada de un juez es falta disciplinaria.\n\n"
      + "3️⃣ Si nunca te notificaron el fallo, el término para impugnar *no ha empezado a correr*. "
      + "No pierdes nada.\n\n"
      + "¿Tienes el número de radicado a la mano?";
  }

  if (d === "perdio") {
    return "Que te la hayan negado no es el final.\n\n"
      + "Tienes *3 días* desde que te notificaron para *impugnar*, y es un plazo corto: si ya "
      + "pasaron, dímelo igual.\n\n"
      + "Impugnar es sencillo — un escrito corto diciendo que no estás de acuerdo, en el "
      + "*mismo juzgado* que falló. No necesitas abogado ni fundamentarlo como un experto: el "
      + "superior revisa el caso completo.\n\n"
      + "Y aunque no impugnes, si tu situación de salud cambia o empeora puedes volver a "
      + "intentarlo con hechos nuevos.\n\n"
      + "¿Quieres que te prepare la impugnación?";
  }

  if (d === "cumplido") {
    return "Qué buena noticia. 🙌\n\n"
      + "Guarda el fallo y todo lo que te hayan entregado: si más adelante vuelven a negarte "
      + "algo del mismo tratamiento, ese fallo te sirve — y ahí el camino ya no es una tutela "
      + "nueva sino el desacato, que es más rápido.\n\n"
      + "Si te pasa cualquier cosa, escríbeme.";
  }

  return "No te entendí bien. Contame en una frase: ¿te respondieron, te la concedieron, "
    + "o siguen sin cumplir?";
}

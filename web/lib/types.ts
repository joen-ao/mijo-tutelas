// Tipos compartidos del dominio de Mijo.

/**
 * Lo que la persona ha ido contando en la conversación.
 *
 * Son los campos que el motor de reglas (lib/ml.ts) necesita para decidir si la
 * tutela procede, más el relato crudo. Todos opcionales a propósito: se van
 * llenando turno a turno y el bot pregunta solo lo que falta.
 */
export interface Respuestas {
  /** Qué servicio le negó la EPS. */
  que_negaron?: string | null;
  /** La EPS o entidad contra la que va la tutela. */
  accionado?: string | null;
  /** Cuándo se lo negaron, TAL COMO lo dijo ("hace dos meses", "el 12 de marzo"). */
  fecha_negacion?: string | null;
  diagnostico?: string | null;
  /** Si ya reclamó ante la entidad. No es requisito legal; suma como prueba. */
  ya_reclamo?: string | null;
  ciudad?: string | null;
  nombre?: string | null;
  cedula?: string | null;
  /** Correo de la persona, o "no tengo". El PDF igual le llega por WhatsApp. */
  correo?: string | null;
  /**
   * Todo lo que ha escrito o dictado, sin procesar. Es lo que lee el modelo
   * para redactar los hechos: ahí está el matiz que ningún campo captura.
   */
  relato?: string | null;
}

/**
 * Una regla de procedencia evaluada, con su fundamento normativo.
 *
 * Reemplaza a los valores SHAP del proyecto anterior. Para un producto jurídico
 * es estrictamente mejor: un juez puede discutir "falta identificar al
 * accionado, art. 13 del Decreto 2591", pero no un peso de 0.37.
 */
export interface Regla {
  clave: string;
  pregunta: string;
  cumple: boolean;
  fundamento: string;
  critica: boolean;
  evidencia: string | null;
}

/** El veredicto del motor sobre si la tutela procede. */
export type Ruteo = "procedente" | "falta_informacion" | "no_es_via_de_tutela";

/** Una conversación camino de convertirse en tutela. */
export interface Caso {
  id: string;
  created_at: string;
  canal: string;
  nombre: string | null;
  telefono: string | null;
  cedula: string | null;
  consentimiento: boolean;
  respuestas: Respuestas;
  // Salida del motor de reglas:
  score: number | null;
  /** Fracción de requisitos de PROCEDENCIA cumplidos. NO es probabilidad de ganar. */
  probabilidad: number | null;
  ruteo: Ruteo | null;
  destino: "radicar" | "no_procede" | "falta_informacion" | null;
  reglas: Regla[];
  estado_flujo: string;
}

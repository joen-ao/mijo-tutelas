/**
 * T27 · Sesión del asesor — cookie firmada, sin dependencias.
 *
 * El panel del asesor muestra cédulas, teléfonos e ingresos. Hasta ahora estaba
 * abierto a quien tuviera la URL. Esto lo cierra con lo mínimo que sirve de
 * verdad: una contraseña compartida y una cookie HMAC que el servidor verifica.
 *
 * Usa Web Crypto (no `node:crypto`) porque el proxy corre en el runtime Edge.
 *
 * REGLA DE ORO para no romper la demo local: si no hay `DASHBOARD_PASSWORD`,
 * en desarrollo NO se pide nada (todo sigue como antes) y en producción se
 * BLOQUEA todo con un aviso claro. Nunca queda abierto en producción por olvido.
 */

export const COOKIE_SESION = "asesor_sesion";
const DURACION_MS = 12 * 60 * 60 * 1000; // 12 h: cubre un día de demo

export function passwordConfigurada(): string | null {
  return process.env.DASHBOARD_PASSWORD?.trim() || null;
}

/** Vercel (y cualquier NODE_ENV=production) se considera "expuesto a internet". */
export function esProduccion(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
}

function secreto(): string {
  // Deriva de la contraseña si no hay secreto propio: una demo no tiene por qué
  // gestionar dos variables, pero si existe SESSION_SECRET se prefiere.
  return process.env.SESSION_SECRET?.trim() || `sesion:${passwordConfigurada() ?? "sin-clave"}`;
}

const enc = new TextEncoder();

async function firmar(mensaje: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secreto()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(mensaje));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, (c) =>
    ({ "+": "-", "/": "_", "=": "" })[c] as string);
}

/** Valor de cookie: `<expira>.<firma>`. No lleva datos, solo vigencia. */
export async function crearCookie(): Promise<string> {
  const expira = Date.now() + DURACION_MS;
  return `${expira}.${await firmar(String(expira))}`;
}

/** Comparación en tiempo constante: no filtra la firma por timing. */
function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

export async function cookieValida(valor: string | undefined): Promise<boolean> {
  if (!valor) return false;
  const [expiraStr, firma] = valor.split(".");
  const expira = Number(expiraStr);
  if (!Number.isFinite(expira) || expira < Date.now()) return false;
  if (!firma) return false;
  return igual(firma, await firmar(expiraStr));
}

export const cookieOpciones = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: DURACION_MS / 1000,
  secure: esProduccion(),
};

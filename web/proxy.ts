import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { COOKIE_SESION, cookieValida, esProduccion, passwordConfigurada } from "@/lib/sesion";

/**
 * Puerta de las rutas internas.
 *
 * (En Next 16 el middleware se llama `proxy.ts`; misma funcionalidad.)
 *
 * En Mijo casi todo es público, porque casi todo lo consumen máquinas:
 *   · `/api/whatsapp` → lo llama Twilio, no un humano. Se protege con la FIRMA
 *     de Twilio dentro de la propia ruta, no con sesión.
 *   · `/api/audio/*` y `/api/pdf/*` → Twilio DESCARGA de ahí la nota de voz y la
 *     tutela para adjuntarlas. Con sesión recibiría 401 y no adjuntaría nada.
 *   · `/tutela` → la abre Chromium headless para imprimir el PDF, sin cookie.
 *     Además el id es un UUID que solo conoce quien recibió el documento.
 *   · `/` → la portada.
 *
 * Lo único cerrado es `/api/dev/*`: dispara la cadena completa (varias llamadas
 * a Gemini y un Chromium) y por ngrok queda expuesto a internet.
 */

/** Exigen sesión. */
const PRIVADAS = ["/api/dev"];

/** Del público y de las máquinas: nunca piden sesión. */
const PUBLICAS = [
  "/", "/login", "/api/login",
  "/api/whatsapp", "/api/audio", "/api/pdf", "/tutela", "/peticion",
  /* Twilio hace POST aquí en CADA turno de una llamada de voz, sin cookie. Si
   * se cierra, recibe 401 en vez de TwiML y corta con su "application error". */
  "/api/voz/twiml",
];

function empieza(path: string, lista: string[]): boolean {
  return lista.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p + "?"));
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const esPrivada = empieza(pathname, PRIVADAS) && !empieza(pathname, PUBLICAS);
  if (!esPrivada) return NextResponse.next();

  const password = passwordConfigurada();

  // Sin contraseña configurada: en local se deja pasar (la demo de siempre);
  // en producción se bloquea. Nunca se queda abierto en internet por olvido.
  if (!password) {
    if (!esProduccion()) return NextResponse.next();
    return NextResponse.json(
      { error: "Las rutas internas están deshabilitadas: falta configurar DASHBOARD_PASSWORD." },
      { status: 503 },
    );
  }

  return cookieValida(req.cookies.get(COOKIE_SESION)?.value).then((ok) => {
    if (ok) return NextResponse.next();
    // Las APIs responden 401 (no redirigen: rompería el fetch del cliente).
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "no autorizado" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?destino=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  });
}

export const config = {
  // Se excluyen estáticos y archivos con extensión para no gastar proxy en ellos.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.[a-zA-Z0-9]+$).*)"],
};

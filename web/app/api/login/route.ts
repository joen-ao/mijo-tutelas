import { NextResponse } from "next/server";

import { COOKIE_SESION, cookieOpciones, crearCookie, passwordConfigurada } from "@/lib/sesion";

/** Retraso fijo ante contraseña incorrecta: desincentiva el barrido por fuerza bruta. */
const CASTIGO_MS = 600;

/** POST /api/login — entrega la cookie de sesión del asesor (T27). */
export async function POST(req: Request) {
  const esperada = passwordConfigurada();
  if (!esperada) {
    return NextResponse.json({ error: "No hay DASHBOARD_PASSWORD configurada." }, { status: 503 });
  }

  const { password } = await req.json().catch(() => ({ password: "" }));
  if (String(password ?? "") !== esperada) {
    await new Promise((r) => setTimeout(r, CASTIGO_MS));
    return NextResponse.json({ error: "Contraseña incorrecta." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_SESION, await crearCookie(), cookieOpciones);
  return res;
}

/** DELETE /api/login — cerrar sesión. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_SESION, "", { ...cookieOpciones, maxAge: 0 });
  return res;
}

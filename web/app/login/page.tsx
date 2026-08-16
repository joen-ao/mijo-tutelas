"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

/** Puerta del panel del asesor (T27). El embudo del cliente no pasa por aquí. */
function Formulario() {
  const router = useRouter();
  const destino = useSearchParams().get("destino") || "/";
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiado, setCopiado] = useState(false);

  // Contraseña de DEMO para que jurados/compañeros entren sin fricción. Solo se
  // muestra si NEXT_PUBLIC_DEMO_PASSWORD está definida (en prod, para la demo).
  const demoPass = process.env.NEXT_PUBLIC_DEMO_PASSWORD;

  async function copiarYLlenar() {
    if (!demoPass) return;
    setPassword(demoPass);
    try { await navigator.clipboard.writeText(demoPass); } catch { /* algunos navegadores lo bloquean; igual queda en el campo */ }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setErr((await res.json().catch(() => ({}))).error ?? "No se pudo entrar.");
        return;
      }
      router.replace(destino);
      router.refresh();
    } catch {
      setErr("No se pudo conectar.");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a5c2e", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 380, background: "#fff", borderRadius: 20, padding: 32, boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <span style={{ fontWeight: 900, fontSize: 20, color: "#1a5c2e" }}>Mijo</span>
        </div>

        <div style={{ fontSize: 20, fontWeight: 900, color: "#1a1c1e" }}>Herramientas internas</div>
        <div style={{ fontSize: 13.5, color: "#6b7075", marginTop: 6, lineHeight: 1.5 }}>
          Rutas de diagnóstico del equipo. Ingresa la contraseña.
        </div>

        <form onSubmit={entrar} style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Contraseña" autoFocus autoComplete="current-password"
            style={{ width: "100%", borderRadius: 10, border: "1.5px solid #dfe3e6", padding: "12px 14px", fontSize: 14, fontFamily: "inherit" }}
          />
          <button disabled={busy || !password}
            style={{ width: "100%", background: "#ffd000", color: "#1a1c1e", padding: 12, borderRadius: 11, fontWeight: 800, fontSize: 15, border: "none", cursor: "pointer", opacity: busy || !password ? 0.6 : 1, fontFamily: "inherit" }}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
          {err && <div style={{ fontSize: 13, color: "#b23434" }}>{err}</div>}
        </form>

        {demoPass && (
          <div style={{ marginTop: 18, background: "#f3f8fc", border: "1px dashed #9ac2e0", borderRadius: 12, padding: "13px 14px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "#1a5c2e", marginBottom: 8 }}>
              🔑 Acceso demo
            </div>
            <div style={{ fontSize: 12.5, color: "#4b5054", marginBottom: 10, lineHeight: 1.5 }}>
              Contraseña del panel — cópiala y pégala para entrar:
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <code style={{ flex: 1, background: "#fff", border: "1px solid #dfe3e6", borderRadius: 8, padding: "9px 11px", fontSize: 14, fontWeight: 700, color: "#1a1c1e", userSelect: "all", overflowX: "auto", whiteSpace: "nowrap" }}>
                {demoPass}
              </code>
              <button type="button" onClick={copiarYLlenar}
                style={{ flexShrink: 0, background: copiado ? "#1a9e5c" : "#0067b1", color: "#fff", border: "none", borderRadius: 8, padding: "9px 13px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                {copiado ? "✓ Copiada" : "Copiar"}
              </button>
            </div>
          </div>
        )}

        <div style={{ fontSize: 12, color: "#9aa0a6", marginTop: 18, lineHeight: 1.5 }}>
          ¿Vienes como cliente? El asesor digital está en{" "}
          <a href="/intake" style={{ color: "#1a5c2e", fontWeight: 700 }}>/intake</a>.
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <Formulario />
    </Suspense>
  );
}

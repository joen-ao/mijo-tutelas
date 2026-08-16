import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Playwright (el render del PDF de la tutela) trae binarios nativos; que Next
   * NO lo empaquete y lo cargue como módulo de Node en tiempo de ejecución. */
  serverExternalPackages: ["playwright", "playwright-core"],

  /* El índice de jurisprudencia se lee con readFileSync en runtime. Al ser una
   * ruta dinámica, el tracing de Next no la descubre y el bundle saldría sin
   * ella: el retrieval y el verificador se quedarían sin corpus. */
  outputFileTracingIncludes: {
    "/*": ["./data/sentencias/*"],
  },
};

export default nextConfig;

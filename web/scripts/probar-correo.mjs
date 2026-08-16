/**
 * Prueba el envío de correo sin levantar el bot entero.
 *
 *   cd web && node scripts/probar-correo.mjs
 *   node scripts/probar-correo.mjs --sin-enviar   # solo resuelve y muestra
 *
 * Genera un PDF de tutela de verdad (el mismo camino que usa el bot: Chromium
 * sobre /tutela), y con él ejecuta las dos funciones. Imprime SIEMPRE
 * destinatarioReal y destinatarioUsado, que es lo que hay que poder auditar:
 * a quién habría ido en producción y a quién se le mandó de verdad.
 *
 * Necesita el dev server arriba en :3000 para imprimir el PDF. Si no está,
 * cae a un PDF mínimo generado a mano, porque lo que se está probando aquí es
 * el correo, no el render.
 */
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");

const { values: arg } = parseArgs({
  options: { "sin-enviar": { type: "boolean", default: false }, ciudad: { type: "string" } },
});

/* Las claves viven en web/.env.local. */
for (const linea of readFileSync(join(WEB, ".env.local"), "utf-8").split("\n")) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.chdir(WEB); // lib/correo.ts lee data/reparto.json con process.cwd()

/* "@/lib/x" → web/lib/x.ts, igual que hace el bundler de Next. */
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith("@/")) {
      const b = join(WEB, spec.slice(2));
      return next(pathToFileURL(/\.(ts|tsx|json)$/.test(b) ? b : `${b}.ts`).href, ctx);
    }
    return next(spec, ctx);
  },
});

const { correoDisponible, resolverReparto, enviarTutelaAlUsuario, radicarPorCorreo } =
  await import("@/lib/correo");
const { guardarTutela } = await import("@/lib/tutela");
const { generarTutelaPdf } = await import("@/lib/tutelaPdf");

/* ── El caso de prueba ───────────────────────────────────────────────────── */

const CIUDAD = arg.ciudad ?? "Bogotá";

const doc = {
  accionante: { nombre: "María Fernanda Ríos Beltrán", cedula: "52.481.905", ciudad: CIUDAD,
    telefono: "+57 300 000 0000", correo: "maria.rios.ejemplo@gmail.com" },
  accionado: { nombre: "Nueva EPS S.A.", tipo: "EPS" },
  hechos: [
    { numero: 1, texto: "La accionante se encuentra afiliada a Nueva EPS S.A. en el régimen contributivo.", fecha: null },
    { numero: 2, texto: "Su médico tratante le ordenó una silla de ruedas por una lesión raquimedular.", fecha: "3 de junio" },
    { numero: 3, texto: "La entidad accionada negó la autorización aduciendo que no está en el plan de beneficios.", fecha: "24 de junio" },
  ],
  derechos_vulnerados: ["salud", "vida digna", "integridad personal"],
  pretensiones: [
    "TUTELAR los derechos fundamentales invocados.",
    "ORDENAR a Nueva EPS S.A. la entrega de la silla de ruedas en 48 horas.",
  ],
  fundamentos: [{
    texto: "La Ley Estatutaria 1751 de 2015 reconoció la salud como derecho fundamental autónomo, "
      + "de modo que su protección no depende de acreditar conexidad con otro derecho.",
    citas: [],
  }],
  medida_provisional: true,
  que_negaron: "la silla de ruedas ordenada por el médico tratante",
  diagnostico: "lesión raquimedular",
  fecha: new Date().toISOString(),
};

/* ── PDF ─────────────────────────────────────────────────────────────────── */

async function pdfDePrueba() {
  /* Chromium abre /tutela?id=… en el DEV SERVER, y el expediente que acabamos de
   * guardar vive en la memoria de ESTE proceso, no en la de aquél. Así que aquí
   * no puede funcionar. Se intenta igual por si algún día comparten almacén, y
   * si no, se busca una tutela real ya impresa en el bucket de Supabase: para
   * probar el correo lo que importa es que el adjunto sea un PDF de verdad. */
  const id = guardarTutela(doc);
  const pdf = await generarTutelaPdf(id).catch(() => null);
  if (pdf) {
    console.log(`· PDF generado con Chromium (${(pdf.length / 1024).toFixed(0)} KB)`);
    return pdf;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (url && key) {
    try {
      const cab = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
      const res = await fetch(`${url}/storage/v1/object/list/documentos`, {
        method: "POST", headers: cab,
        // `prefix` es obligatorio en la API de listado, aunque sea vacío.
        body: JSON.stringify({ prefix: "", limit: 1, sortBy: { column: "created_at", order: "desc" } }),
      });
      const [obj] = await res.json();
      if (obj?.name) {
        const bin = await fetch(`${url}/storage/v1/object/public/documentos/${obj.name}`);
        const buf = Buffer.from(await bin.arrayBuffer());
        console.log(`· PDF real tomado del bucket de Supabase (${(buf.length / 1024).toFixed(0)} KB)`);
        return buf;
      }
    } catch { /* seguimos al mínimo */ }
  }

  console.warn("· sin PDF real disponible; se adjunta uno mínimo.");
  console.warn("  Lo que se prueba aquí es el correo, no el render.");
  const minimo = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 62>>stream
BT /F1 14 Tf 72 720 Td (ACCION DE TUTELA - PDF de prueba) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>`;
  return Buffer.from(minimo, "utf-8");
}

/* ── Main ────────────────────────────────────────────────────────────────── */

console.log("═══ CONFIGURACIÓN ═══");
console.log(`  RESEND_API_KEY .......... ${correoDisponible() ? "presente" : "AUSENTE (no se enviará nada)"}`);
console.log(`  CORREO_FROM ............. ${process.env.CORREO_FROM || "(default) Mijo <onboarding@resend.dev>"}`);
console.log(`  USUARIO_OVERRIDE_EMAIL .. ${process.env.USUARIO_OVERRIDE_EMAIL || "(sin override)"}`);
console.log(`  REPARTO_OVERRIDE_EMAIL .. ${process.env.REPARTO_OVERRIDE_EMAIL || "(SIN OVERRIDE — iría a la oficina REAL)"}`);
console.log("");

console.log("═══ RESOLUCIÓN DE REPARTO ═══");
for (const c of ["Bogotá", "Bogotá D.C.", "medellin", "Medellín", "CALI", "Ibagué", "Leticia"]) {
  const r = resolverReparto(c);
  console.log(`  ${c.padEnd(14)} → ${r ? `${r.correo}  ${r.verificado ? "[verificado]" : "[SIN VERIFICAR]"}` : "no está en el mapa → portal en línea"}`);
}
console.log("");

if (!process.env.REPARTO_OVERRIDE_EMAIL && !arg["sin-enviar"]) {
  console.error("✗ ABORTADO: REPARTO_OVERRIDE_EMAIL no está definida.");
  console.error("  Sin override, radicarPorCorreo() enviaría a una Oficina Judicial REAL.");
  console.error("  Una tutela de prueba ocupa un turno de reparto y el tiempo de un juez que");
  console.error("  le corresponde a alguien con un caso de verdad. Define la variable, o corre");
  console.error("  con --sin-enviar para ver solo la resolución.");
  process.exit(1);
}

if (arg["sin-enviar"]) {
  console.log("· --sin-enviar: no se envía nada. Listo.");
  process.exit(0);
}

const pdf = await pdfDePrueba();
const nombreArchivo = "accion-de-tutela.pdf";

console.log("\n═══ 1 · CORREO A LA PERSONA ═══");
const u = await enviarTutelaAlUsuario({
  para: "maria.rios.ejemplo@gmail.com",
  nombre: doc.accionante.nombre,
  pdf, nombreArchivo,
  kit: {
    doc,
    correoUsuario: "maria.rios.ejemplo@gmail.com",
    telefono: "+57 300 000 0000",
    reparto: resolverReparto(CIUDAD),
  },
});
console.log(`  destinatarioReal ... maria.rios.ejemplo@gmail.com`);
console.log(`  destinatarioUsado .. ${u.destinatarioUsado.join(", ")}`);
console.log(`  resultado .......... ${u.ok ? `OK id=${u.id}` : `FALLÓ: ${u.error}`}`);

console.log("\n═══ 2 · RADICACIÓN ANTE REPARTO ═══");
const r = await radicarPorCorreo({
  ciudad: CIUDAD,
  accionante: { nombre: doc.accionante.nombre, cedula: doc.accionante.cedula },
  accionado: doc.accionado.nombre,
  derechos: doc.derechos_vulnerados,
  pdf, nombreArchivo,
});
console.log(`  oficina ............ ${r.oficina ?? "—"}`);
console.log(`  destinatarioReal ... ${r.destinatarioReal ?? "—"}`);
console.log(`  destinatarioUsado .. ${r.destinatarioUsado.join(", ") || "—"}`);
console.log(`  resultado .......... ${r.ok ? `OK id=${r.id}` : `FALLÓ: ${r.error}`}`);

console.log("\n· Listo. Revisa la bandeja de los overrides.");

/**
 * Activa Supabase en la app, pero SOLO si el proyecto está listo para recibirla.
 *
 * Existe por un accidente concreto: las llaves estaban en el .env.local de la
 * RAÍZ, y Next lee el de `web/` (ahí corre `npm run dev`). Al copiarlas, el bot
 * se rompió en el primer mensaje, porque las tablas todavía no existían y
 * `createLead` lanza excepción si el insert falla. O sea: media conexión es
 * peor que ninguna.
 *
 * Así que aquí se comprueba PRIMERO que la tabla `casos` y los buckets existan,
 * y solo entonces se copian las llaves. Si falta algo, no se toca nada y se
 * dice qué correr.
 *
 * Uso:
 *   node scripts/activar-supabase.mjs            # comprueba y activa
 *   node scripts/activar-supabase.mjs --revisar  # solo comprueba
 *   node scripts/activar-supabase.mjs --apagar   # vuelve a modo local
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_RAIZ = join(RAIZ, ".env.local");
const ENV_WEB = join(RAIZ, "web", ".env.local");
const VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"];

const { values: arg } = parseArgs({
  options: { revisar: { type: "boolean", default: false }, apagar: { type: "boolean", default: false } },
});

function leerEnv(ruta) {
  const out = {};
  let txt = "";
  try { txt = readFileSync(ruta, "utf-8"); } catch { return out; }
  for (const linea of txt.split("\n")) {
    if (linea.trim().startsWith("#") || !linea.includes("=")) continue;
    const [k, ...resto] = linea.split("=");
    out[k.trim()] = resto.join("=").trim();
  }
  return out;
}

function escribirVars(ruta, valores) {
  let txt = readFileSync(ruta, "utf-8");
  for (const [k, v] of Object.entries(valores)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    txt = re.test(txt) ? txt.replace(re, `${k}=${v}`) : `${txt}\n${k}=${v}`;
  }
  writeFileSync(ruta, txt);
}

if (arg.apagar) {
  escribirVars(ENV_WEB, Object.fromEntries(VARS.map((k) => [k, ""])));
  console.log("· Supabase APAGADO. La app vuelve a modo local (casos en memoria).");
  console.log("· Reinicia el dev server para que tome el cambio.");
  process.exit(0);
}

/* Las llaves pueden estar en cualquiera de los dos archivos. */
const raiz = leerEnv(ENV_RAIZ);
const web = leerEnv(ENV_WEB);
const llaves = {};
for (const k of VARS) llaves[k] = (raiz[k] || web[k] || "").trim();

const url = llaves.NEXT_PUBLIC_SUPABASE_URL;
const key = llaves.SUPABASE_SECRET_KEY || llaves.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error("✗ No encuentro las llaves de Supabase ni en .env.local ni en web/.env.local.");
  console.error("  Pégalas en cualquiera de los dos y vuelve a correr esto.");
  process.exit(1);
}

const cab = { apikey: key, Authorization: `Bearer ${key}` };
const problemas = [];

/* 1. ¿Existe la tabla casos? Sin ella, createLead lanza y el bot no arranca. */
const res = await fetch(`${url}/rest/v1/casos?select=id&limit=1`, { headers: cab });
if (res.status === 404) {
  problemas.push("Falta la tabla `casos` → corre web/supabase/migrations/0001_init.sql");
} else if (!res.ok) {
  problemas.push(`La tabla \`casos\` respondió HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
}

/* 2. ¿Existen los buckets? Sin ellos el audio y el PDF caen al respaldo por
 *    ngrok — no rompe, pero es justo lo que queríamos evitar. */
const bres = await fetch(`${url}/storage/v1/bucket`, { headers: cab });
const buckets = bres.ok ? (await bres.json()).map((b) => b.id) : [];
for (const [b, mig] of [["audios", "0002_bucket_audios.sql"], ["documentos", "0003_bucket_documentos.sql"]]) {
  if (!buckets.includes(b)) problemas.push(`Falta el bucket \`${b}\` → corre web/supabase/migrations/${mig}`);
}

console.log(`· tabla casos .... ${res.ok ? "ok" : `HTTP ${res.status}`}`);
console.log(`· buckets ........ ${buckets.length ? buckets.join(", ") : "ninguno"}`);

if (problemas.length) {
  console.error("\n✗ Supabase NO se activó, para no dejar el bot a medias:\n");
  for (const p of problemas) console.error(`   · ${p}`);
  console.error("\n  Dashboard → SQL Editor → pega el archivo → Run. Luego repite este comando.");
  process.exit(1);
}

if (arg.revisar) {
  console.log("\n✓ Todo listo. Corre sin --revisar para activarlo.");
  process.exit(0);
}

escribirVars(ENV_WEB, llaves);
console.log("\n✓ Supabase ACTIVADO en web/.env.local.");
console.log("  · los casos persisten entre reinicios");
console.log("  · la nota de voz y el PDF se sirven desde Supabase, no por ngrok");
console.log("  Reinicia el dev server para que tome el cambio.");

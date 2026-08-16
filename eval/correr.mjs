/**
 * Eval de Mijo. Mide las dos cosas que pueden hacer daño de verdad:
 *
 *   1. EXACTITUD DEL CLASIFICADOR — ¿acierta el derecho vulnerado y sabe decir
 *      "esto no es lo mío"? Se compara contra las etiquetas humanas de
 *      casos.json. Un falso positivo aquí (creer que una pensión es salud)
 *      produce una tutela que no sirve.
 *
 *   2. TASA DE RECHAZO DEL VERIFICADOR — de las citas que el modelo PROPONE,
 *      ¿cuántas no resisten el contraste con el corpus? Esta métrica no
 *      necesita etiqueta humana: el corpus es la verdad, así que sale sobre
 *      todos los casos aunque no tengan 'esperado'.
 *
 *      Es la cifra que le da sentido al proyecto. No mide si el modelo es
 *      bueno; mide cuántas citas falsas habrían llegado a un juzgado si no
 *      existiera el verificador.
 *
 * Uso:
 *   node eval/correr.mjs                # todos los casos
 *   node eval/correr.mjs --limite 5     # prueba rápida
 *   node eval/correr.mjs --md           # solo la tabla para pegar en el README
 *
 * Sin dependencias: usa los hooks de resolución de Node para entender el alias
 * "@/..." de Next y su type stripping para importar los .ts directamente.
 */
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(RAIZ, "web");

const { values: arg } = parseArgs({
  options: {
    limite: { type: "string" },
    md: { type: "boolean", default: false },
  },
});

/* Las claves viven en web/.env.local; sin GEMINI_API_KEY no hay nada que medir. */
for (const linea of readFileSync(join(WEB, ".env.local"), "utf-8").split("\n")) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

/* lib/jurisprudencia.ts busca el índice con process.cwd(). */
process.chdir(WEB);

/* "@/lib/x" → web/lib/x.ts, que es lo que hace el bundler de Next vía tsconfig. */
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith("@/")) {
      const base = join(WEB, spec.slice(2));
      const ruta = /\.(ts|tsx|json)$/.test(base) ? base : `${base}.ts`;
      return next(pathToFileURL(ruta).href, ctx);
    }
    return next(spec, ctx);
  },
});

/* Después de registrar los hooks, si no el alias no se resuelve. */
const { clasificar } = await import("@/lib/prompts/clasificar");
const { redactar } = await import("@/lib/prompts/redactar");
const { buscarJurisprudencia } = await import("@/lib/jurisprudencia");
const { corpusDelIndice, verificarCita } = await import("@/lib/verificador");

const { casos } = JSON.parse(readFileSync(join(RAIZ, "eval", "casos.json"), "utf-8"));
const lista = arg.limite ? casos.slice(0, parseInt(arg.limite, 10)) : casos;
const etiquetados = lista.filter((c) => c.esperado && c.esperado.derecho_fundamental);

const corpus = await corpusDelIndice();

const res = {
  clasificador: { total: 0, derechoOk: 0, tutelableOk: 0, medidaOk: 0, fallos: [] },
  verificador: { propuestas: 0, aceptadas: 0, rechazadas: 0, porMotivo: {}, casos: 0 },
};

for (const [i, caso] of lista.entries()) {
  if (!arg.md) process.stderr.write(`\r  caso ${i + 1}/${lista.length}…`);

  const clas = await clasificar(caso.relato).catch(() => null);

  if (caso.esperado?.derecho_fundamental) {
    res.clasificador.total++;
    if (!clas) {
      res.clasificador.fallos.push({ id: caso.id, motivo: "el clasificador no respondió" });
    } else {
      const okDerecho = clas.derecho_fundamental === caso.esperado.derecho_fundamental;
      const okTutelable = clas.es_tutelable === caso.esperado.es_tutelable;
      if (okDerecho) res.clasificador.derechoOk++;
      if (okTutelable) res.clasificador.tutelableOk++;
      if (clas.requiere_medida_provisional === caso.esperado.requiere_medida_provisional) {
        res.clasificador.medidaOk++;
      }
      if (!okDerecho || !okTutelable) {
        res.clasificador.fallos.push({
          id: caso.id,
          esperado: `${caso.esperado.derecho_fundamental} / tutelable=${caso.esperado.es_tutelable}`,
          obtenido: `${clas.derecho_fundamental} / tutelable=${clas.es_tutelable}`,
        });
      }
    }
  }

  /* El verificador solo tiene sentido si el caso llega a redacción: si no es
   * tutelable, no se redacta nada y no hay citas que contrastar. */
  if (clas && !clas.es_tutelable) continue;

  const sentencias = await buscarJurisprudencia(caso.relato, 5).catch(() => []);
  const borrador = await redactar(caso.relato, clas?.derecho_fundamental ?? "salud", sentencias).catch(() => null);
  if (!borrador) continue;

  res.verificador.casos++;
  for (const f of borrador.fundamentos) {
    for (const cita of f.citas) {
      res.verificador.propuestas++;
      const r = verificarCita(cita, corpus);
      if ("verificada" in r) {
        res.verificador.aceptadas++;
      } else {
        res.verificador.rechazadas++;
        res.verificador.porMotivo[r.motivo] = (res.verificador.porMotivo[r.motivo] ?? 0) + 1;
      }
    }
  }
}
if (!arg.md) process.stderr.write("\n");

/* ── Salida ──────────────────────────────────────────────────────────────── */

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
const c = res.clasificador;
const v = res.verificador;

const md = [
  `<!-- generado por: node eval/correr.mjs · ${lista.length} casos -->`,
  "",
  "| Métrica | Resultado |",
  "|---|---|",
  `| Casos evaluados | ${lista.length} (${etiquetados.length} con etiqueta humana) |`,
  `| Acierta el derecho vulnerado | **${pct(c.derechoOk, c.total)}** (${c.derechoOk}/${c.total}) |`,
  `| Acierta si es tutelable (dentro de alcance) | **${pct(c.tutelableOk, c.total)}** (${c.tutelableOk}/${c.total}) |`,
  `| Acierta la medida provisional | ${pct(c.medidaOk, c.total)} (${c.medidaOk}/${c.total}) |`,
  `| Citas que el modelo propuso | ${v.propuestas} (en ${v.casos} casos redactados) |`,
  `| Citas **rechazadas** por el verificador | **${pct(v.rechazadas, v.propuestas)}** (${v.rechazadas}/${v.propuestas}) |`,
  `| Citas que llegaron al documento | ${v.aceptadas} |`,
  "",
  v.rechazadas
    ? `**Por qué se rechazaron:** ${Object.entries(v.porMotivo).map(([k, n]) => `${k}: ${n}`).join(" · ")}`
    : "**Ninguna cita fue rechazada en esta corrida.**",
].join("\n");

console.log(md);

if (!arg.md && c.fallos.length) {
  console.log("\n── Casos donde falló el clasificador ──");
  for (const f of c.fallos) {
    console.log(`  #${f.id}: esperado ${f.esperado ?? "?"} → obtenido ${f.obtenido ?? f.motivo}`);
  }
}

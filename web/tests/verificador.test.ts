/**
 * Tests del verificador de citas.
 *
 * Corren con el runner que trae Node, sin dependencias:
 *     cd web && node --test tests/
 *
 * El corpus va falso a propósito. Lo que se prueba es la LÓGICA de rechazo, y
 * con un corpus de dos sentencias inventadas cada caso queda explícito y el
 * test no depende de que el índice de 29 MB esté construido.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  verificarCita,
  verificarRedaccion,
  normalizarId,
  extraerIds,
  MAX_REINTENTOS,
  type Corpus,
} from "../lib/verificador.ts";
import type { Redaccion } from "../lib/prompts/redactar.ts";

/* Con las rarezas del corpus real: comillas curvas, tildes, una nota al pie
 * incrustada y saltos de línea en mitad de la frase. */
const T760 = `II. CONSIDERACIONES
La Corte ha reiterado que el derecho a la salud es un derecho fundamental
autónomo[14] y que, en consecuencia, las entidades promotoras de salud no pueden
negar la prestación de un servicio ordenado por el médico tratante alegando que
no se encuentra incluido en el plan de beneficios. “El acceso efectivo a los
servicios que se requieran es la garantía del derecho”.`;

const C313 = `La Sala considera que la exclusión de servicios debe ser expresa y
que toda duda se resuelve a favor del usuario del sistema de salud.`;

const corpus: Corpus = {
  texto: (id) => (id === "T-760-08" ? T760 : id === "C-313-14" ? C313 : null),
  meta: (id) =>
    id === "T-760-08"
      ? { anio: 2008, url: "https://www.corteconstitucional.gov.co/relatoria/2008/T-760-08.htm", resultado: "concedida" }
      : id === "C-313-14"
        ? { anio: 2014, url: "https://www.corteconstitucional.gov.co/relatoria/2014/C-313-14.htm", resultado: "concedida" }
        : null,
};

/* ── 1. Cita válida ──────────────────────────────────────────────────────── */

test("una cita real y literal pasa, con sello y enlace a la fuente", () => {
  const r = verificarCita(
    {
      sentencia: "T-760/08",
      // Copiada del texto pero con la tipografía cambiada y el salto de línea
      // vuelto espacio, que es exactamente lo que hace un modelo al citar.
      frase: "las entidades promotoras de salud no pueden negar la prestación de un servicio ordenado por el médico tratante",
    },
    corpus,
  );

  assert.ok("verificada" in r, "debería pasar la verificación");
  assert.equal(r.sentencia, "T-760-08");
  assert.equal(r.etiqueta, "T-760 de 2008");
  assert.equal(r.anio, 2008);
  assert.match(r.url, /corteconstitucional\.gov\.co\/relatoria\/2008\/T-760-08\.htm/);
});

test("la nota al pie incrustada en el corpus no rompe una cita legítima", () => {
  // En el texto real dice "autónomo[14] y que", y el modelo cita sin el [14].
  const r = verificarCita(
    { sentencia: "T-760 de 2008", frase: "el derecho a la salud es un derecho fundamental autónomo y que" },
    corpus,
  );
  assert.ok("verificada" in r, "la nota al pie no debería invalidar la cita");
});

test("una nota al pie pegada al punto final tampoco la rompe", () => {
  /* Regresión real: el corpus trae "…garantía del derecho”[22]." y al quitar la
   * nota quedaba "derecho" ." —con espacio antes del punto—, mientras el modelo
   * escribe "derecho”." sin nota. Un solo carácter de diferencia estaba
   * rechazando una de cada tres citas BUENAS en el eval. */
  const corpusConNota: Corpus = {
    texto: () => "El acceso efectivo a los servicios que se requieran es la garantía del derecho[22].",
    meta: () => ({ anio: 2008, url: "https://x", resultado: "concedida" }),
  };
  const r = verificarCita(
    { sentencia: "T-760/08", frase: "El acceso efectivo a los servicios que se requieran es la garantía del derecho." },
    corpusConNota,
  );
  assert.ok("verificada" in r, "quitar la nota no debe dejar un espacio antes del punto");
});

/* ── 2. ID inexistente ───────────────────────────────────────────────────── */

test("una sentencia que no existe en el corpus se rechaza", () => {
  const r = verificarCita(
    {
      sentencia: "T-855/19", // no está en el corpus: es inventada
      frase: "el derecho a la salud debe garantizarse de manera integral y continua a todos los afiliados",
    },
    corpus,
  );

  assert.ok(!("verificada" in r));
  assert.equal(r.motivo, "id_inexistente");
  assert.equal(r.sentencia, "T-855-19");
});

/* ── 3. Texto alterado ───────────────────────────────────────────────────── */

test("una sentencia real con la frase retocada se rechaza", () => {
  // La sentencia existe y la frase suena a ella, pero el corpus dice
  // "no pueden negar" y aquí se invirtió a "pueden negar". Es el caso
  // peligroso: pasa cualquier revisión humana rápida.
  const r = verificarCita(
    { sentencia: "T-760-08", frase: "las entidades promotoras de salud pueden negar la prestación de un servicio ordenado por el médico tratante" },
    corpus,
  );

  assert.ok(!("verificada" in r));
  assert.equal(r.motivo, "frase_no_literal");
});

test("una frase demasiado corta no cuenta como cita", () => {
  const r = verificarCita({ sentencia: "T-760-08", frase: "derecho a la salud" }, corpus);
  assert.ok(!("verificada" in r));
  assert.equal(r.motivo, "frase_muy_corta");
});

/* ── 4. Variantes del formato de id ──────────────────────────────────────── */

test("todas las formas de escribir una cita se normalizan al mismo id", () => {
  for (const forma of ["T-760/08", "T-760-08", "T-760 de 2008", "T-760 del 2008", "T-760/2008", "t-760/08", "Sentencia T-760 de 2008"]) {
    assert.equal(normalizarId(forma), "T-760-08", `falló con "${forma}"`);
  }

  assert.equal(normalizarId("SU-480/97"), "SU-480-97");
  assert.equal(normalizarId("C-313 de 2014"), "C-313-14");
  assert.equal(normalizarId("T-001-21"), "T-001-21");

  // Sin año no se puede saber de qué sentencia habla.
  assert.equal(normalizarId("T-760"), null);
  assert.equal(normalizarId("la EPS me negó el medicamento"), null);

  // Y las encuentra dentro de prosa suelta, sin repetirlas.
  assert.deepEqual(
    extraerIds("Como se dijo en T-760 de 2008 y se reiteró en la T-760/08, además de C-313/14."),
    ["T-760-08", "C-313-14"],
  );
});

/* ── 5. Eliminación tras agotar los reintentos ───────────────────────────── */

test("si el modelo insiste en citar mal, la cita se elimina y queda el hueco", async () => {
  const mala: Redaccion = {
    derechos_vulnerados: ["salud"],
    fundamentos: [
      {
        texto: "El derecho a la salud es fundamental y autónomo, y su protección no depende de que el servicio esté incluido en el plan de beneficios.",
        citas: [{ sentencia: "T-999/20", frase: "esta frase jamás la escribió la Corte Constitucional en ninguna parte" }],
      },
      {
        texto: "La accionada omitió autorizar el servicio ordenado por el médico tratante, con lo que desconoció el precedente aplicable.",
        citas: [{ sentencia: "C-313-14", frase: "toda duda se resuelve a favor del usuario del sistema de salud" }],
      },
    ],
  };

  let veces = 0;
  const r = await verificarRedaccion(mala, corpus, async () => {
    veces++;
    return mala; // el modelo se emperra y devuelve lo mismo
  });

  assert.equal(veces, MAX_REINTENTOS, "debe reintentar exactamente MAX_REINTENTOS veces");
  assert.equal(r.intentos, MAX_REINTENTOS);

  // La cita inventada no llegó al documento y su fundamento quedó marcado.
  assert.equal(r.fundamentos[0].citas.length, 0);
  assert.equal(r.fundamentos[0].hueco, true);
  assert.match(r.fundamentos[0].texto, /derecho a la salud es fundamental/);

  // La cita buena del otro fundamento sobrevivió intacta.
  assert.equal(r.fundamentos[1].citas.length, 1);
  assert.equal(r.fundamentos[1].citas[0].sentencia, "C-313-14");
  assert.equal(r.fundamentos[1].hueco, false);

  assert.equal(r.rechazadas.length, 1);
  assert.equal(r.rechazadas[0].motivo, "id_inexistente");
});

test("si la regeneración arregla las citas, no se gastan los dos intentos", async () => {
  const mala: Redaccion = {
    derechos_vulnerados: ["salud"],
    fundamentos: [{ texto: "La exclusión de un servicio debe ser expresa y toda duda favorece al usuario del sistema.", citas: [{ sentencia: "T-999/20", frase: "una frase que no existe en ninguna sentencia del corpus" }] }],
  };
  const buena: Redaccion = {
    derechos_vulnerados: ["salud"],
    fundamentos: [{ texto: mala.fundamentos[0].texto, citas: [{ sentencia: "C-313/14", frase: "la exclusión de servicios debe ser expresa y que toda duda se resuelve a favor del usuario" }] }],
  };

  const r = await verificarRedaccion(mala, corpus, async () => buena);

  assert.equal(r.intentos, 1);
  assert.equal(r.rechazadas.length, 0);
  assert.equal(r.fundamentos[0].citas.length, 1);
  assert.equal(r.fundamentos[0].hueco, false);
});

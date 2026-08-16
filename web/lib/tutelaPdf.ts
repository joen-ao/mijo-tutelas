/**
 * Imprime la acción de tutela a PDF con Chromium headless. El bot lo manda como
 * DOCUMENTO por WhatsApp.
 *
 * Viene de lib/flyerShot.ts, que hacía lo mismo con page.screenshot() para el
 * flyer. Cambian el destino y el método de salida; el resto —el navegador que
 * se reusa entre llamadas, el badge de dev que hay que esconder, y sobre todo
 * que un fallo devuelva null en vez de romper la conversación— ya estaba
 * resuelto y se conserva tal cual.
 */
import type { Browser } from "playwright";

// Base INTERNA para que Chromium abra la página directo (no vía ngrok, que en
// el plan free mete una página de advertencia y arruinaría el documento).
const BASE_INTERNA = process.env.TUTELA_INTERNAL_BASE ?? "http://localhost:3000";

/**
 * Chromium se abre y se CIERRA en cada tutela, al revés que en flyerShot.ts,
 * que lo deja vivo entre capturas.
 *
 * No es preferencia: dejarlo vivo tumbó la máquina. Chromium levanta una
 * decena de procesos y, sumados a los workers de Next, el sistema llegó al
 * tope de `fork()` y empezó a devolver EAGAIN — se cayó el dev server y hasta
 * la terminal dejó de abrir procesos. Una tutela se genera una vez por
 * conversación, así que el segundo que cuesta arrancarlo no se nota; que el
 * server se caiga en mitad de la demo, sí.
 *
 * Los flags apuntan a lo mismo: --no-zygote y --single-process concentran el
 * render en un proceso en vez de repartirlo entre varios hijos.
 */
const ARGS_CHROMIUM = [
  "--no-zygote",
  "--single-process",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--disable-extensions",
];

async function abrirNavegador(): Promise<Browser> {
  const { chromium } = await import("playwright");
  return chromium.launch({ headless: true, args: ARGS_CHROMIUM });
}

/** URL de la página imprimible del expediente. */
/* `ruta` permite imprimir también el derecho de petición, que usa la misma
 * mecánica (página imprimible + Chromium) con otra plantilla. Por defecto
 * "tutela", así que todas las llamadas anteriores siguen igual. */
export function tutelaUrl(base: string, id: string, conInstructivo = true, ruta = "tutela"): string {
  const qs = conInstructivo ? "" : "&instructivo=0";
  return `${base.replace(/\/+$/, "")}/${ruta}?id=${encodeURIComponent(id)}${qs}`;
}

/**
 * Renderiza el expediente → PDF carta. Devuelve null si algo falla.
 *
 * `conInstructivo` decide si va la hoja de "qué hacer con este documento". Para
 * la persona, sí: la va a leer haciendo la fila. Para el JUZGADO, no — un
 * escrito que se radica no lleva pegado un instructivo para el ciudadano, y
 * mandárselo así al reparto se ve como lo que sería: un documento sin revisar.
 */
export async function generarTutelaPdf(id: string, conInstructivo = true, ruta = "tutela"): Promise<Buffer | null> {
  const url = tutelaUrl(BASE_INTERNA, id, conInstructivo, ruta);
  let browser;
  let page;
  try {
    browser = await abrirNavegador();
    page = await browser.newPage();
    /* "domcontentloaded" y no "networkidle": en desarrollo el server mantiene
     * abierto el websocket de HMR, así que la red NUNCA queda ociosa y la
     * espera se agota siempre. Lo que de verdad hay que esperar es que el
     * documento esté en el DOM, y para eso está el locator de abajo. El
     * timeout es holgado porque la primera petición a /tutela compila la
     * ruta. */
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    // Ocultar el badge de Next dev (la "N") y cualquier overlay de desarrollo,
    // que si no se cuela en una esquina del documento.
    await page.addStyleTag({
      content: "nextjs-portal, #__next-build-watcher, [data-nextjs-toast], [data-next-badge-root] { display: none !important }",
    }).catch(() => {});
    const doc = page.locator(`.${ruta}__doc`).first();
    await doc.waitFor({ state: "visible", timeout: 10000 });
    // Si el expediente expiró, no mandamos un PDF con el mensaje de error.
    if (await page.locator(`.${ruta}__error`).count()) return null;
    // emulateMedia("print") para que valgan las reglas @page y los saltos.
    await page.emulateMedia({ media: "print" });
    return await page.pdf({
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
    });
  } catch (e) {
    console.error("[tutela-pdf]", e instanceof Error ? e.message : e);
    return null;
  } finally {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

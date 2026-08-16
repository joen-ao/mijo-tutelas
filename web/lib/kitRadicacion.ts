/**
 * El kit de radicación: qué hacer con la tutela, en lenguaje de persona.
 *
 * Va en el correo y también por WhatsApp. Quien lo lee puede tener 68 años,
 * estar enfermo y no haber pisado un juzgado nunca. Así que aquí no hay
 * "sírvase remitir": hay "escribe esto en esa casilla".
 *
 * Los datos del formulario en línea se arman con lo que la persona YA contó y
 * con la salida del clasificador. No se le pide nada que no haya dicho, y los
 * derechos que hay que marcar salen del modelo, no de una lista fija: si el
 * caso invoca vida digna además de salud, eso es lo que tiene que marcar.
 */
import type { Tutela } from "@/lib/tutela";
import { enumerar } from "@/lib/tutela";

export const URL_TUTELA_EN_LINEA = "https://procesojudicial.ramajudicial.gov.co/TutelaEnLinea";

export interface DatosKit {
  doc: Tutela;
  correoUsuario: string;
  telefono: string;
  /** La oficina que resolvió lib/correo.ts, o null si la ciudad no está en el mapa. */
  reparto: { ciudad: string; oficina: string; correo: string; verificado: boolean } | null;
}

/** El kit en texto plano (para WhatsApp y como respaldo del correo). */
export function kitRadicacionTexto({ doc, correoUsuario, telefono, reparto }: DatosKit): string {
  const derechos = enumerar(doc.derechos_vulnerados);
  const l: string[] = [];

  l.push("CÓMO RADICAR TU TUTELA");
  l.push("");
  l.push("Tienes dos caminos. Cualquiera de los dos sirve; elige el que te quede más fácil.");
  l.push("");
  l.push("── OPCIÓN 1: por internet (lo más rápido) ──");
  l.push("");
  l.push(URL_TUTELA_EN_LINEA);
  l.push("");
  l.push("Ese formulario te va a pedir estos datos. Los tienes todos aquí, cópialos tal cual:");
  l.push("");
  l.push("  TUS DATOS");
  l.push("  · Tipo de documento: Cédula de ciudadanía");
  l.push(`  · Número de documento: ${doc.accionante.cedula || "(el tuyo)"}`);
  l.push(`  · Nombre completo: ${doc.accionante.nombre || "(el tuyo)"}`);
  l.push(`  · Correo: ${correoUsuario}`);
  l.push(`  · Teléfono: ${telefono || "(el tuyo)"}`);
  l.push(`  · Ciudad: ${doc.accionante.ciudad || "(la tuya)"}`);
  l.push("");
  l.push("  CONTRA QUIÉN VA (la EPS)");
  l.push("  · Tipo de persona: Jurídica");
  l.push(`  · Nombre o razón social: ${doc.accionado.nombre || "(tu EPS)"}`);
  l.push("  · Identificación: el NIT de la EPS (si no lo tienes, escribe el nombre completo);");
  l.push("    el juzgado igual la identifica.");
  l.push("  · Correo: el de notificaciones judiciales de tu EPS (aparece en su página web).");
  l.push("");
  l.push("  DERECHOS QUE DEBES MARCAR");
  for (const d of doc.derechos_vulnerados) l.push(`  ☑ ${d}`);
  l.push("");
  l.push("  ADJUNTO");
  l.push("  · Sube el PDF de la tutela que te mandamos, firmado.");
  l.push("  · Adjunta también tu cédula y la orden médica.");
  l.push("");

  l.push("── OPCIÓN 2: en persona o por correo ──");
  l.push("");
  if (reparto) {
    l.push(`Te corresponde la ${reparto.oficina}.`);
    l.push(`Correo: ${reparto.correo}`);
    if (!reparto.verificado) {
      l.push("(Confirma esta dirección en ramajudicial.gov.co antes de enviar: no pudimos");
      l.push(" verificarla contra el directorio oficial.)");
    }
    l.push("");
  }
  l.push("También puedes llevarla impresa a CUALQUIER juzgado de tu ciudad y preguntar");
  l.push("por la oficina de reparto. Lleva dos copias: entregas una y te devuelven la otra");
  l.push("sellada. Esa sellada es tu comprobante, guárdala.");
  l.push("");

  l.push("── LO QUE NADIE TE DICE ──");
  l.push("");
  l.push("· Radicar una tutela es GRATIS. Si alguien te cobra, no es legal.");
  l.push("· NO necesitas abogado. El artículo 10 del Decreto 2591 de 1991 dice que");
  l.push("  «no será necesario actuar por medio de apoderado».");
  l.push("· El juez tiene 10 días para responderte (artículo 29 del mismo decreto).");
  l.push("· Si el juez te dice que no, tienes 3 días para impugnar. Basta un escrito");
  l.push("  corto diciendo que no estás de acuerdo, en el mismo juzgado.");
  l.push("");
  l.push(`Tu tutela invoca: ${derechos || "el derecho a la salud"}.`);

  return l.join("\n");
}

/** El mismo kit en HTML sobrio, para el cuerpo del correo. */
export function kitRadicacionHtml(datos: DatosKit): string {
  const { doc, correoUsuario, telefono, reparto } = datos;
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const fila = (k: string, v: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#555;white-space:nowrap">${esc(k)}</td>`
    + `<td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`;

  return `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1c1e;max-width:640px">
  <h2 style="margin:0 0 4px;font-size:20px">Tu acción de tutela está lista</h2>
  <p style="margin:0 0 20px;color:#555">Va adjunta en PDF. Aquí te explico qué hacer con ella.</p>

  <div style="background:#eef1ec;padding:14px 18px;margin:0 0 20px">
    <b>Imprímela, fírmala a mano y radícala.</b> Es gratis, no necesitas abogado
    y el juez tiene <b>10 días</b> para responderte.
  </div>

  <h3 style="font-size:16px;margin:24px 0 8px">Opción 1 · Por internet</h3>
  <p style="margin:0 0 12px">
    <a href="${URL_TUTELA_EN_LINEA}" style="color:#1a5c2e">${URL_TUTELA_EN_LINEA}</a>
  </p>
  <p style="margin:0 0 8px;color:#555">Ese formulario pide exactamente esto — cópialo tal cual:</p>
  <table style="border-collapse:collapse;margin:0 0 8px">
    ${fila("Tipo de documento", "Cédula de ciudadanía")}
    ${fila("Número", doc.accionante.cedula || "(el tuyo)")}
    ${fila("Nombre completo", doc.accionante.nombre || "(el tuyo)")}
    ${fila("Correo", correoUsuario)}
    ${fila("Teléfono", telefono || "(el tuyo)")}
    ${fila("Ciudad", doc.accionante.ciudad || "(la tuya)")}
  </table>
  <table style="border-collapse:collapse;margin:0 0 12px">
    ${fila("Accionado — tipo", "Persona jurídica")}
    ${fila("Accionado — nombre", doc.accionado.nombre || "(tu EPS)")}
    ${fila("Accionado — correo", "el de notificaciones judiciales de tu EPS")}
  </table>
  <p style="margin:0 0 6px"><b>Derechos que debes marcar en el formulario:</b></p>
  <ul style="margin:0 0 16px;padding-left:20px">
    ${doc.derechos_vulnerados.map((d) => `<li>${esc(d)}</li>`).join("")}
  </ul>

  <h3 style="font-size:16px;margin:24px 0 8px">Opción 2 · En persona o por correo</h3>
  ${reparto
    ? `<p style="margin:0 0 12px">Te corresponde la <b>${esc(reparto.oficina)}</b><br>
         <span style="color:#555">${esc(reparto.correo)}</span>
         ${reparto.verificado ? "" : `<br><span style="color:#8b6b20;font-size:13px">
           Confirma esta dirección en ramajudicial.gov.co antes de enviar: no pudimos
           verificarla contra el directorio oficial.</span>`}
       </p>`
    : ""}
  <p style="margin:0 0 16px">
    También puedes llevarla impresa a <b>cualquier juzgado</b> de tu ciudad y preguntar por la
    oficina de reparto. Lleva <b>dos copias</b>: entregas una y te devuelven la otra sellada.
    Esa sellada es tu comprobante.
  </p>

  <h3 style="font-size:16px;margin:24px 0 8px">Lo que nadie te dice</h3>
  <ul style="margin:0 0 16px;padding-left:20px;color:#333">
    <li>Radicar una tutela es <b>gratis</b>. Si alguien te cobra, no es legal.</li>
    <li><b>No necesitas abogado</b> — art. 10 del Decreto 2591 de 1991:
        «no será necesario actuar por medio de apoderado».</li>
    <li>El juez falla en <b>10 días</b> (art. 29).</li>
    <li>Si te dicen que no, tienes <b>3 días</b> para impugnar con un escrito corto.</li>
  </ul>

  <p style="margin:24px 0 0;padding-top:12px;border-top:1px solid #e4e7e3;font-size:13px;color:#777">
    Preparado por Mijo a partir de lo que contaste. Revísalo y corrige cualquier dato antes de
    radicarlo. Las sentencias citadas fueron verificadas contra el texto oficial de la Corte
    Constitucional. Mijo no presta servicios de abogacía.
  </p>
</div>`.trim();
}

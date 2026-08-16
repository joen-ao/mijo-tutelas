import type { Metadata } from "next";
import { de, enumerar, fechaLarga, frasePedido, obtenerTutela } from "@/lib/tutela";
import "./tutela.css";

/* Todo sale del expediente en memoria: no hay nada que prerenderizar. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Acción de tutela" };

/**
 * La acción de tutela, maquetada como se radica en un juzgado.
 *
 * Esta página existe para ser IMPRESA (lib/tutelaPdf.ts la abre con Chromium y
 * la manda a page.pdf), no para navegarla. De ahí las decisiones que en una
 * web serían raras y aquí son las correctas: serifa, texto justificado,
 * márgenes de oficio en centímetros y saltos de página explícitos.
 *
 * La segunda hoja no es parte del escrito judicial: es el instructivo para la
 * persona. Va dentro del mismo PDF a propósito, porque quien recibe esto por
 * WhatsApp no tiene a quién preguntarle qué hacer con el archivo.
 */
export default async function TutelaPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; instructivo?: string }>;
}) {
  const { id, instructivo } = await searchParams;
  const t = id ? obtenerTutela(id) : null;
  /* El instructivo es para la PERSONA, no para el juzgado. Cuando la tutela se
   * radica por correo ante reparto se imprime con instructivo=0: un escrito
   * judicial no lleva pegada una guía de "qué hacer con este documento". */
  const conInstructivo = instructivo !== "0";

  if (!t) {
    return (
      <div className="tutela tutela__error">
        <p>El expediente no está disponible o ya expiró.</p>
      </div>
    );
  }

  const derechos = enumerar(t.derechos_vulnerados);
  const ciudad = t.accionante.ciudad || "___________";

  return (
    <div className="tutela">
      <article className="tutela__doc">
        {/* ── Encabezado ─────────────────────────────────────────────── */}
        <header className="tutela__enc">
          <p>
            Señor
            <br />
            <strong>JUEZ {(ciudad || "").toUpperCase()} (REPARTO)</strong>
            <br />
            E. S. D.
          </p>
          <p className="tutela__ref">
            <strong>REFERENCIA:</strong> ACCIÓN DE TUTELA
            <br />
            <strong>ACCIONANTE:</strong> {t.accionante.nombre || "___________"}
            <br />
            <strong>ACCIONADO:</strong> {t.accionado.nombre || "___________"}
            <br />
            <strong>DERECHOS:</strong> {derechos || "salud"}
          </p>
        </header>

        {/* ── Encabezamiento ─────────────────────────────────────────── */}
        <p className="tutela__intro">
          <strong>{(t.accionante.nombre || "___________").toUpperCase()}</strong>, mayor de
          edad, identificado con cédula de ciudadanía número{" "}
          <strong>{t.accionante.cedula || "___________"}</strong>, residente en {ciudad},
          actuando <strong>en nombre propio</strong>, acudo a su Despacho para instaurar{" "}
          <strong>ACCIÓN DE TUTELA</strong> contra{" "}
          <strong>{t.accionado.nombre || "___________"}</strong>, con el fin de que se
          protejan mis derechos fundamentales a {derechos || "la salud"}, con fundamento en
          el artículo 86 de la Constitución Política y en el Decreto 2591 de 1991, según los
          siguientes:
        </p>

        {/* ── I. Hechos ──────────────────────────────────────────────── */}
        <h2>I. HECHOS</h2>
        <ol className="tutela__hechos">
          {t.hechos.map((h) => (
            <li key={h.numero}>
              {h.texto}
              {h.fecha ? <span className="tutela__fecha"> ({h.fecha})</span> : null}
            </li>
          ))}
        </ol>

        {/* ── II. Derechos ───────────────────────────────────────────── */}
        <h2>II. DERECHOS FUNDAMENTALES VULNERADOS</h2>
        <p>
          Considero vulnerados mis derechos fundamentales a {derechos || "la salud"}. La
          salud es un derecho fundamental autónomo, reconocido como tal por la Ley
          Estatutaria 1751 de 2015, por lo que su protección no depende de demostrar
          conexidad con otro derecho.
        </p>

        {/* ── III. Pretensiones ──────────────────────────────────────── */}
        <h2>III. PRETENSIONES</h2>
        <p>Con fundamento en lo anterior, respetuosamente solicito al señor Juez:</p>
        <ol className="tutela__pretensiones">
          {t.pretensiones.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ol>

        {/* ── IV. Medida provisional ─────────────────────────────────────
            Va justo después de PRETENSIONES y ANTES de los fundamentos: es lo
            que el juez tiene que resolver YA, antes de ponerse a estudiar el
            fondo. Enterrada al final de un escrito de seis hojas, se lee tarde. */}
        {t.medida_provisional ? (
          <>
            <h2>IV. SOLICITUD DE MEDIDA PROVISIONAL</h2>
            <p>
              De manera respetuosa y con fundamento en el <strong>artículo 7 del Decreto 2591
              de 1991</strong>, solicito al señor Juez que, <strong>desde la admisión y sin
              esperar el fallo</strong>, ordene como medida provisional la autorización y
              entrega inmediata de lo solicitado.
              {t.razon_urgencia ? (
                <> La urgencia se concreta en lo siguiente: {t.razon_urgencia}.</>
              ) : null}{" "}
              La espera del término de los diez días puede causar un perjuicio irremediable,
              pues el daño que se produciría en ese lapso no sería reparable con el fallo
              posterior.
            </p>
          </>
        ) : null}

        {/* ── Fundamentos ─────────────────────────────────────────────── */}
        <h2>{t.medida_provisional ? "V" : "IV"}. FUNDAMENTOS DE DERECHO</h2>
        {t.fundamentos.map((f, i) => (
          <div className="tutela__fundamento" key={i}>
            <p>{f.texto}</p>
            {f.citas.map((c, j) => (
              <blockquote className="tutela__cita" key={j}>
                <p className="tutela__cita-frase">«{c.frase}»</p>
                <p className="tutela__cita-pie">
                  Corte Constitucional, Sentencia <strong>{c.etiqueta}</strong>.
                  <span className="tutela__sello"> ✓ cita verificada contra el texto oficial</span>
                  <br />
                  <span className="tutela__fuente">{c.url}</span>
                </p>
              </blockquote>
            ))}
          </div>
        ))}

        {/* ── Juramento ──────────────────────────────────────────────── */}
        <h2>{t.medida_provisional ? "VI" : "V"}. JURAMENTO</h2>
        <p>
          Bajo la gravedad del juramento manifiesto que no he presentado otra acción de
          tutela por los mismos hechos y derechos aquí invocados, ante ninguna autoridad
          judicial (artículo 37 del Decreto 2591 de 1991).
        </p>

        {/* ── Notificaciones ─────────────────────────────────────────── */}
        <h2>{t.medida_provisional ? "VII" : "VI"}. NOTIFICACIONES</h2>
        {/* Sin justificar: las líneas para rellenar a mano son tan largas que el
            justificado abre huecos enormes entre las palabras. */}
        <p className="tutela__notif">
          <strong>Accionante:</strong> {t.accionante.nombre || "___________"} — {ciudad}.
          <br />
          Dirección: ______________________.
          {" "}Teléfono: {t.accionante.telefono || "______________"}.
          <br />
          Correo: {t.accionante.correo || "______________________"}.
          <br />
          <strong>Accionado:</strong> {t.accionado.nombre || "___________"}, en la dirección
          de su oficina principal o de atención al usuario en {ciudad}.
        </p>

        {/* ── Anexos ─────────────────────────────────────────────────── */}
        <h2>{t.medida_provisional ? "VIII" : "VII"}. ANEXOS</h2>
        <ol className="tutela__anexos">
          <li>Copia de mi cédula de ciudadanía.</li>
          {t.diagnostico ? <li>Copia de la historia clínica o del diagnóstico.</li> : null}
          <li>Copia de la orden médica {t.que_negaron ? de(t.que_negaron) : "de lo solicitado"}.</li>
          <li>Copia de la negativa de la entidad accionada, si se recibió por escrito.</li>
        </ol>

        {/* ── Firma ──────────────────────────────────────────────────── */}
        <p className="tutela__cierre">
          Del señor Juez, respetuosamente,
        </p>
        <div className="tutela__firma">
          <p className="tutela__firma-linea">&nbsp;</p>
          <p>
            <strong>{(t.accionante.nombre || "___________").toUpperCase()}</strong>
            <br />
            C.C. {t.accionante.cedula || "___________"}
          </p>
          <p className="tutela__lugar">
            {ciudad}, {fechaLarga(t.fecha)}
          </p>
        </div>
      </article>

      {/* ── Hoja 2: el instructivo (solo para la persona) ─────────────── */}
      {conInstructivo ? (
      <article className="tutela__doc tutela__instrucciones">
        <h1>Qué hacer con este documento</h1>

        <h3>1. Imprímelo y fírmalo</h3>
        <p>
          Imprime dos copias. Firma las dos a mano donde dice tu nombre. Una la
          entregas y la otra te la devuelven sellada: <strong>esa es tu comprobante</strong>,
          guárdala.
        </p>

        <h3>2. Llévalo a cualquier juzgado</h3>
        <p>
          Puedes radicarlo en <strong>cualquier juzgado de {ciudad}</strong>. No importa
          cuál: preguntas por la <strong>oficina de reparto</strong> (o de apoyo judicial) y
          allí lo reciben. Si en tu municipio hay un solo juzgado, ese mismo sirve. También
          puedes enviarlo por correo electrónico al juzgado; pide el correo en la página de
          la Rama Judicial o por teléfono.
        </p>

        <h3>3. Qué llevar</h3>
        <ul>
          <li>Las dos copias de la tutela firmadas.</li>
          <li>Copia de tu cédula.</li>
          <li>La orden médica y todo lo que tengas de la EPS (mensajes, correos, negativas).</li>
        </ul>

        <h3>4. No necesitas abogado</h3>
        <p>
          El artículo 10 del Decreto 2591 de 1991 dice que{" "}
          <strong>«no será necesario actuar por medio de apoderado»</strong>. Nadie te puede
          exigir uno, y radicar una tutela <strong>no cuesta nada</strong>. Si alguien te
          pide dinero por recibirla, no es legal.
        </p>

        <h3>5. El juez tiene 10 días</h3>
        <p>
          Contados desde que la radicas (artículo 29 del Decreto 2591 de 1991). Es un plazo
          corto y es obligatorio. Si te dan un número de radicado, anótalo: con ese número
          consultas cómo va.
        </p>

        <h3>6. Si te va mal, puedes impugnar</h3>
        <p>
          Tienes <strong>3 días</strong> desde que te notifican el fallo para impugnarlo.
          Basta con un escrito corto diciendo que no estás de acuerdo, en el mismo juzgado.
        </p>

        <p className="tutela__aviso">
          Este documento lo preparó Mijo a partir de lo que contaste. Revísalo antes de
          radicarlo y corrige cualquier dato que no esté bien. Las sentencias citadas fueron
          verificadas una por una contra el texto oficial de la Corte Constitucional.
        </p>
      </article>
      ) : null}
    </div>
  );
}

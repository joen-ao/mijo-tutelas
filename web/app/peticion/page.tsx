import type { Metadata } from "next";
import {
  articuloDelTermino,
  fechaLargaIso,
  fechaLargaUtc,
  fraseSolicitud,
  nombreDelTipo,
  obtenerPeticion,
  vencimiento,
} from "@/lib/peticion";
import "./peticion.css";

/* Todo sale del documento en memoria: no hay nada que prerenderizar. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Derecho de petición" };

/**
 * El derecho de petición, maquetado como se radica en una EPS.
 *
 * Misma idea que /tutela: esta página existe para ser IMPRESA (Chromium la abre
 * y la manda a page.pdf), no para navegarla. De ahí la serifa, el justificado y
 * los márgenes de oficio en centímetros.
 *
 * Lo que NO se copia de la tutela es el encabezado: aquí no hay juez ni reparto.
 * Va dirigida a la entidad, y el escrito lleva su propio término encima —
 * decirle a la EPS en su cara cuántos días tiene y de qué artículo salen es la
 * mitad del efecto de este documento.
 */
export default async function PeticionPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; instructivo?: string }>;
}) {
  const { id, instructivo } = await searchParams;
  const p = id ? obtenerPeticion(id) : null;
  /* Igual que en la tutela: cuando la petición se manda por correo a la EPS se
   * imprime con instructivo=0. Un escrito que se radica ante la entidad no lleva
   * pegada una guía dirigida al ciudadano. */
  const conInstructivo = instructivo !== "0";

  if (!p) {
    return (
      <div className="peticion peticion__error">
        <p>El documento no está disponible o ya expiró.</p>
      </div>
    );
  }

  const ciudad = p.peticionario.ciudad || "___________";
  const entidad = p.destinatario.nombre || "___________";
  const nombre = p.peticionario.nombre || "___________";
  /* El término lo calcula el código a partir de la modalidad (Ley 1755, art.
   * 14). Nunca sale de un modelo ni se escribe a mano en la plantilla. */
  const plazo = vencimiento(p);

  return (
    <div className="peticion">
      <article className="peticion__doc">
        {/* ── Encabezado / destinatario ───────────────────────────────── */}
        <header className="peticion__enc">
          <p className="peticion__lugar-fecha">
            {ciudad}, {fechaLargaIso(p.fecha)}
          </p>
          <p>
            Señores
            <br />
            <strong>{entidad.toUpperCase()}</strong>
            <br />
            Oficina de Atención al Usuario
            {p.destinatario.correo ? (
              <>
                <br />
                {p.destinatario.correo}
              </>
            ) : null}
            <br />
            {ciudad}
          </p>
          <p className="peticion__ref">
            <strong>REFERENCIA:</strong> DERECHO DE PETICIÓN
            <br />
            <strong>ARTÍCULO 23 C.P. — LEY 1755 DE 2015</strong>
            <br />
            <strong>PETICIONARIO:</strong> {nombre}
            <br />
            <strong>ASUNTO:</strong> {p.objeto}
          </p>
        </header>

        {/* ── Identificación del peticionario ─────────────────────────── */}
        <p className="peticion__intro">
          <strong>{nombre.toUpperCase()}</strong>, mayor de edad, identificado con cédula de
          ciudadanía número <strong>{p.peticionario.cedula || "___________"}</strong>,
          residente en {ciudad}, actuando <strong>en nombre propio</strong>, con fundamento
          en el artículo 23 de la Constitución Política y en la Ley 1755 de 2015, presento
          ante ustedes <strong>DERECHO DE PETICIÓN</strong> en interés particular, en los
          siguientes términos:
        </p>

        {/* ── I. Objeto ───────────────────────────────────────────────── */}
        <h2>I. OBJETO DE LA PETICIÓN</h2>
        <p>
          Solicito respetuosamente a {entidad} que se pronuncie de fondo y por escrito
          sobre {fraseSolicitud(p.que_pide) || "lo solicitado"}, en los términos que se
          concretan en el acápite III de este escrito.
        </p>

        {/* ── II. Fundamentos de hecho ────────────────────────────────── */}
        <h2>II. FUNDAMENTOS DE HECHO</h2>
        <ol className="peticion__hechos">
          {p.hechos.map((h) => (
            <li key={h.numero}>
              {h.texto}
              {h.fecha ? <span className="peticion__fecha"> ({h.fecha})</span> : null}
            </li>
          ))}
        </ol>

        {/* ── III. Petición concreta ──────────────────────────────────── */}
        <h2>III. PETICIÓN CONCRETA</h2>
        <p>Con fundamento en lo anterior, respetuosamente solicito:</p>
        <ol className="peticion__peticiones">
          {p.peticiones.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ol>

        {/* ── IV. Fundamentos de derecho ──────────────────────────────── */}
        <h2>IV. FUNDAMENTOS DE DERECHO</h2>
        <p>
          El artículo 23 de la Constitución Política reconoce a toda persona el derecho de
          presentar peticiones respetuosas a las autoridades y a obtener <em>pronta
          resolución</em>. La Ley 1755 de 2015 regula ese derecho fundamental y, en su
          artículo 13, precisa que su ejercicio <strong>es gratuito y no requiere abogado</strong>.
        </p>
        <p>
          Esta petición se dirige a una entidad del Sistema de Seguridad Social en Salud. El{" "}
          <strong>artículo 33 de la Ley 1755 de 2015</strong> dispone que a las Instituciones
          del Sistema de Seguridad Social Integral se les aplican, en sus relaciones con los
          usuarios, las disposiciones sobre derecho de petición previstas en esa ley, de modo
          que la naturaleza privada de la entidad no la releva del deber de responder.
        </p>
        {/* El término va en NEGRITA y con su artículo: es el dato que hace que
            esto se responda, y el que la entidad no puede decir que no vio. */}
        <p className="peticion__termino">
          Conforme al {articuloDelTermino(p.tipo)}, esta {nombreDelTipo(p.tipo)} debe
          resolverse dentro de los{" "}
          <strong>
            {plazo.dias} días hábiles siguientes a su recepción
          </strong>
          . De radicarse en la fecha de este escrito, el término vencería el{" "}
          <strong>{fechaLargaUtc(plazo.fecha)}</strong>.
          {p.tipo === "documentos_informacion" ? (
            <>
              {" "}
              Vencido ese lapso sin respuesta, se entenderá para todos los efectos legales
              que la solicitud fue aceptada y las copias deberán entregarse dentro de los
              tres (3) días siguientes (artículo 14, numeral 1).
            </>
          ) : null}{" "}
          Si excepcionalmente no fuere posible resolver dentro de ese término, la entidad
          deberá informármelo <strong>antes de su vencimiento</strong>, expresando los
          motivos de la demora y señalando el plazo en que responderá, que no podrá exceder
          de {plazo.maximo} días hábiles (parágrafo del artículo 14).
        </p>
        <p>
          Advierto que la respuesta debe ser <strong>de fondo, clara, precisa y congruente</strong>{" "}
          con lo pedido. Una respuesta evasiva, parcial o que se limite a acusar recibo no
          satisface el derecho de petición, y su desconocimiento habilita la acción de tutela
          por vulneración del derecho fundamental consagrado en el artículo 23 de la
          Constitución.
        </p>

        {/* ── V. Notificaciones ───────────────────────────────────────── */}
        <h2>V. NOTIFICACIONES</h2>
        {/* Sin justificar: las líneas para rellenar a mano abren huecos enormes
            entre las palabras cuando se justifican. */}
        <p className="peticion__notif">
          Recibiré respuesta y notificaciones en:
          <br />
          Dirección: ______________________, {ciudad}.
          <br />
          Teléfono: {p.peticionario.telefono || "______________"}.
          <br />
          Correo electrónico: {p.peticionario.correo || "______________________"}.
        </p>

        {/* ── VI. Anexos ──────────────────────────────────────────────── */}
        <h2>VI. ANEXOS</h2>
        <ol className="peticion__anexos">
          <li>Copia de mi cédula de ciudadanía.</li>
          {p.diagnostico ? <li>Copia de la historia clínica o del diagnóstico.</li> : null}
          <li>Copia de la orden médica, si la hay.</li>
        </ol>

        {/* ── Firma ───────────────────────────────────────────────────── */}
        <p className="peticion__cierre">Atentamente,</p>
        <div className="peticion__firma">
          <p className="peticion__firma-linea">&nbsp;</p>
          <p>
            <strong>{nombre.toUpperCase()}</strong>
            <br />
            C.C. {p.peticionario.cedula || "___________"}
            {p.peticionario.telefono ? (
              <>
                <br />
                Tel. {p.peticionario.telefono}
              </>
            ) : null}
          </p>
        </div>
      </article>

      {/* ── Hoja 2: el instructivo (solo para la persona) ──────────────── */}
      {conInstructivo ? (
        <article className="peticion__doc peticion__instrucciones">
          <h1>Qué hacer con este documento</h1>

          <h3>1. Imprímelo y fírmalo</h3>
          <p>
            Imprime dos copias y firma las dos a mano donde dice tu nombre. Una la entregas
            y la otra <strong>te la devuelven con sello y fecha</strong>: esa es tu
            comprobante y sin ella no puedes probar cuándo radicaste. Guárdala.
          </p>

          <h3>2. Radícalo en tu EPS</h3>
          <p>
            Llévalo a cualquier oficina de atención al usuario de {entidad}, o mándalo por
            correo electrónico a su buzón de PQRS. Si lo mandas por correo,{" "}
            <strong>guarda el mensaje enviado</strong>: esa es tu constancia.{" "}
            Ninguna entidad privada puede negarse a recibirlo y radicarlo (parágrafo 3 del
            artículo 32 de la Ley 1755 de 2015).
          </p>

          <h3>3. Tienen {plazo.dias} días hábiles para responderte</h3>
          <p>
            Contados desde que lo reciben, no desde hoy ({articuloDelTermino(p.tipo)}).
            Hábiles quiere decir que no cuentan sábados, domingos ni festivos. Si radicas
            hoy, el término se vence alrededor del{" "}
            <strong>{fechaLargaUtc(plazo.fecha)}</strong>.
          </p>

          <h3>4. No cuesta nada y no necesitas abogado</h3>
          <p>
            El artículo 13 de la Ley 1755 de 2015 dice que el ejercicio del derecho de
            petición <strong>«es gratuito y puede realizarse sin necesidad de
            representación a través de abogado»</strong>. Si alguien te cobra por recibirlo,
            no es legal.
          </p>

          <h3>5. Si no te responden, o te responden con evasivas</h3>
          <p>
            Ahí sí procede la <strong>acción de tutela</strong>, y llegas con algo que antes
            no tenías: la prueba escrita de que pediste y de que no te respondieron. Escríbeme
            otra vez por WhatsApp con el radicado y te armo la tutela.
          </p>

          <p className="peticion__aviso">
            Este documento lo preparó Mijo a partir de lo que contaste. Revísalo antes de
            radicarlo y corrige cualquier dato que no esté bien. Los términos que aparecen
            aquí son los del artículo 14 de la Ley 1755 de 2015.
          </p>
        </article>
      ) : null}
    </div>
  );
}

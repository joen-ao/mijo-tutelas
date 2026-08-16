import type { Metadata } from "next";
import { tamanoCorpus } from "@/lib/jurisprudencia";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mijo · tu tutela de salud por WhatsApp",
  description:
    "Cuenta lo que te negó tu EPS y recibe tu acción de tutela en PDF, lista para radicar, "
    + "con sentencias de la Corte Constitucional verificadas.",
};

/**
 * Portada. No es el producto —el producto es WhatsApp— sino la página que ve
 * quien llega por el enlace del repo o del video: qué es esto, y la prueba de
 * que el corpus está cargado de verdad.
 */
export default function Home() {
  const corpus = tamanoCorpus();

  return (
    <main className="portada">
      <h1>Mijo</h1>
      <p className="portada__claim">
        Le cuentas por WhatsApp que tu EPS te negó algo —escrito o en nota de voz— y te
        devuelve tu <strong>acción de tutela en PDF</strong>, lista para radicar, con
        sentencias de la Corte Constitucional <strong>citadas y verificadas una por una</strong>.
      </p>

      <ul className="portada__datos">
        <li><b>{corpus.sentencias.toLocaleString("es-CO")}</b> sentencias de salud indexadas</li>
        <li><b>{corpus.chunks.toLocaleString("es-CO")}</b> pasajes citables</li>
        <li><b>{corpus.conEmbedding.toLocaleString("es-CO")}</b> con embedding para la analogía</li>
      </ul>

      <p className="portada__nota">
        La tutela no necesita abogado y no cuesta nada: el artículo 10 del Decreto 2591
        de 1991 dice que «no será necesario actuar por medio de apoderado». El juez tiene
        10 días para fallar.
      </p>

      <p className="portada__pie">
        Mijo no presta servicios de abogacía: prepara un borrador que la persona revisa,
        firma y radica por sí misma.
      </p>
    </main>
  );
}

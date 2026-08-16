import { PointCloud } from "@/components/sections/point-cloud";

export function Corpus() {
  return (
    <section className="bg-night py-[96px]">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-12 px-6 pin:grid-cols-[55fr_45fr] pin:px-10">
        <div>
          <div className="eyebrow eyebrow-night">Sobre qué razona</div>
          <h2 className="mt-3.5 max-w-[480px] text-pretty text-[clamp(28px,4vw,38px)] font-semibold leading-[1.12] tracking-[-0.025em] text-white">
            20.481 pasajes indexados. Cinco entran al documento.
          </h2>
          <PointCloud />
        </div>

        <p className="text-pretty font-mono text-[12.5px] leading-[1.9] text-night-muted">
          23.750 sentencias de la Corte Constitucional (1992–2021) · 6.888 filtradas a salud
          · 20.481 pasajes indexados · 100% con embedding · BM25 + embeddings fusionados con
          RRF · índice de 28 MB, sin base vectorial
        </p>
      </div>
    </section>
  );
}

"use client";

import { useRef } from "react";
import { useFitViewport } from "@/hooks/use-fit-viewport";
import { usePinned } from "@/hooks/use-media-query";
import { useScrollProgressEffect } from "@/hooks/use-scroll-progress";
import { cn } from "@/lib/utils";

const CARDS = [
  {
    tag: "TRIAJE",
    body: "Si todavía no le has pedido nada formal a la EPS, la tutela no es el primer paso: es un derecho de petición, más rápido y muchas veces suficiente.",
    source: "Art. 23 C.P. · Ley 1755 de 2015",
  },
  {
    tag: "URGENCIA",
    body: "Si hay quimioterapia, diálisis u oxígeno de por medio, pide medida provisional para que el juez ordene la atención de inmediato.",
    source: "Art. 7, Decreto 2591 de 1991",
    warn: true,
  },
  {
    tag: "RADICA",
    body: "Por correo a la Oficina Judicial de Reparto de tu ciudad. Vía legal plena desde la Ley 2213 de 2022.",
    source: "10 ciudades mapeadas · 8 verificadas contra el CENDOJ",
  },
  {
    tag: "10 DÍAS",
    body: "Vencido el término, Mijo escribe de vuelta: «¿ya te respondieron?». Nadie más hace esa pregunta.",
    source: "Art. 29, Decreto 2591 de 1991",
  },
  {
    tag: "DESACATO",
    body: "Si el juez concedió y la EPS no cumple, ahí es donde la gente se queda varada. Mijo prepara el incidente ante el mismo juez.",
    source: "Art. 52, Decreto 2591 de 1991",
  },
];

/** Rejilla de fondo: se mueve a un tercio de la velocidad de las tarjetas. */
const GRID_STYLE = {
  backgroundImage:
    "repeating-linear-gradient(to right, rgba(44,47,49,0.06) 0 1px, transparent 1px 88px)",
  maskImage:
    "linear-gradient(to bottom, transparent, #000 16%, #000 84%, transparent)",
  WebkitMaskImage:
    "linear-gradient(to bottom, transparent, #000 16%, #000 84%, transparent)",
} as const;

export function Milestones() {
  const pinned = usePinned();
  const wrapRef = useRef<HTMLElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useFitViewport(fitRef, pinned);

  // El progreso vertical de la sección se convierte en avance horizontal.
  useScrollProgressEffect(wrapRef, pinned, (progress) => {
    const row = rowRef.current;
    const grid = gridRef.current;
    if (!row) return;

    if (!pinned) {
      row.style.transform = "none";
      if (grid) grid.style.backgroundPositionX = "0px";
      return;
    }

    const travel = Math.max(0, row.scrollWidth - row.clientWidth + 80);
    row.style.transform = `translate3d(${(-progress * travel).toFixed(1)}px, 0, 0)`;
    // El desfase con las tarjetas es lo que hace legible el recorrido.
    if (grid) grid.style.backgroundPositionX = `${(-progress * travel * 0.35).toFixed(1)}px`;
  });

  return (
    <section
      ref={wrapRef}
      // 100vh de recorrido para ~720px de avance horizontal: más alto solo añadía scroll vacío.
      className="relative border-y border-line bg-surface pin:h-[200vh]"
    >
      <div className="relative flex flex-col justify-center overflow-visible py-[88px] pin:sticky pin:top-0 pin:h-screen pin:overflow-hidden pin:py-0">
        <div
          ref={gridRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 hidden pin:block"
          style={GRID_STYLE}
        />

        <div ref={fitRef} className="relative w-full">
          <div className="mx-auto w-full max-w-[1200px] px-6 pin:px-10">
            <div className="eyebrow">No es un generador de PDFs</div>
            <h2 className="mb-8 mt-3.5 max-w-[700px] text-pretty text-[clamp(30px,4.4vw,42px)] font-semibold leading-[1.1] tracking-[-0.025em] text-ink">
              Un abogado no arranca por la tutela. Mijo tampoco.
            </h2>
          </div>

          <div className="relative overflow-hidden">
            {/* Los bordes se desvanecen para que se lea que la fila sigue. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 z-10 hidden w-20 bg-gradient-to-r from-surface to-transparent pin:block"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 z-10 hidden w-20 bg-gradient-to-l from-surface to-transparent pin:block"
            />
            <div
              ref={rowRef}
              className="flex flex-wrap items-stretch gap-6 px-6 will-change-transform pin:flex-nowrap pin:px-10"
            >
              {CARDS.map((card, i) => (
                <article
                  key={card.tag}
                  className={cn(
                    "flex flex-col border border-t-[3px] p-[26px] transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-1 pin:flex-[0_0_380px]",
                    card.warn
                      ? "border-[#ecdfc2] border-t-gold bg-[#fdf8ec] bg-[linear-gradient(155deg,rgba(184,134,11,0.07),transparent_58%)] hover:border-gold/50 hover:shadow-[0_18px_34px_-24px_rgba(184,134,11,0.55)]"
                      : "border-line border-t-brand bg-canvas bg-[linear-gradient(155deg,rgba(26,92,46,0.055),transparent_58%)] hover:border-brand/40 hover:shadow-[0_18px_34px_-24px_rgba(18,66,32,0.5)]",
                  )}
                >
                  <div className="flex items-baseline gap-3">
                    <span
                      className={cn(
                        "font-mono text-xs font-semibold tracking-[0.12em]",
                        card.warn ? "text-gold" : "text-brand",
                      )}
                    >
                      {card.tag}
                    </span>
                    <span className="ml-auto font-mono text-[11px] tabular-nums text-faint">
                      0{i + 1}
                    </span>
                  </div>

                  <div
                    aria-hidden
                    className={cn(
                      "mt-3.5 h-px",
                      card.warn ? "bg-[#ecdfc2]" : "bg-line",
                    )}
                  />

                  <p className="mt-4 flex-1 text-pretty text-[16.5px] leading-[1.5] text-ink">
                    {card.body}
                  </p>

                  {/* mt-auto alinea los pies aunque los cuerpos midan distinto. */}
                  <p className="mt-6 font-mono text-[10.5px] leading-[1.5] text-faint">
                    {card.source}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

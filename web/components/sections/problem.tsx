"use client";

import { useEffect, useRef } from "react";
import { useReveal } from "@/components/ui/reveal";
import { useInView } from "@/hooks/use-in-view";
import { useReducedMotion } from "@/hooks/use-media-query";
import { formatEsCo } from "@/lib/format";

const COLUMNS = 18;
const ROWS = 9;
const DOTS = COLUMNS * ROWS;
const TICK_MS = 60;
/** La retícula entra ya poblada: vacía no dice nada. */
const SEED = 96;
/** Tutelas de salud radicadas en el año; el contador sigue desde ahí. */
const YEAR_TO_DATE = 312500;

/**
 * Cada punto es una tutela y la cuenta nunca vuelve a cero: lo que se ve es el
 * acumulado del año creciendo. Se manipula el DOM directamente para no
 * re-renderizar 162 nodos varias veces por segundo.
 */
function DotGrid() {
  const { ref, inView } = useInView<HTMLDivElement>({ once: false, rootMargin: "0px" });
  const counterRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!inView || reduced) return;
    const grid = ref.current;
    if (!grid) return;

    const dots = Array.from(grid.children) as HTMLElement[];
    let index = 0;
    let total = YEAR_TO_DATE;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;

    const light = (dot: HTMLElement) => {
      dot.style.background = "var(--color-brand)";
      dot.style.transform = "scale(1)";
    };

    const showTotal = () => {
      if (counterRef.current) counterRef.current.textContent = formatEsCo(total);
    };

    const seed = () => {
      const upTo = Math.min(SEED, dots.length);
      for (; index < upTo; index += 1) light(dots[index]);
      total += upTo;
      showTotal();
    };

    seed();

    const interval = setInterval(() => {
      if (index >= dots.length) {
        dots.forEach((dot) => (dot.style.opacity = "0"));
        resetTimer = setTimeout(() => {
          dots.forEach((dot) => {
            dot.style.opacity = "1";
            dot.style.background = "var(--color-line)";
            dot.style.transform = "scale(.55)";
          });
          index = 0;
          seed();
        }, 420);
        index = dots.length + 1;
        return;
      }

      light(dots[index]);
      index += 1;
      total += 1;
      showTotal();
    }, TICK_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(resetTimer);
    };
  }, [inView, reduced, ref]);

  return (
    <>
      <div
        ref={ref}
        aria-hidden
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${COLUMNS}, 1fr)` }}
      >
        {Array.from({ length: DOTS }, (_, i) => (
          <div
            key={i}
            className="aspect-square rounded-full bg-line"
            style={{
              transform: "scale(.55)",
              transition: "transform .25s ease, background-color .25s ease, opacity .5s ease",
            }}
          />
        ))}
      </div>

      <div className="mt-[18px] flex items-baseline gap-2.5">
        <div
          ref={counterRef}
          className="tabular-nums text-[30px] font-semibold tracking-[-0.02em] text-brand"
        >
          {formatEsCo(YEAR_TO_DATE)}
        </div>
        <p className="text-[13px] leading-[1.4] text-muted">
          una tutela de salud cada 100 segundos, día y noche
        </p>
      </div>
    </>
  );
}

export function Problem() {
  const eyebrow = useReveal<HTMLDivElement>();
  const title = useReveal<HTMLHeadingElement>(60);
  const body = useReveal<HTMLParagraphElement>(120);
  const card = useReveal<HTMLDivElement>(160);

  return (
    <section className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-16 px-6 py-[88px] pin:grid-cols-[58fr_42fr] pin:px-10 pin:py-[96px]">
      <div>
        <div {...eyebrow} className="eyebrow">
          El problema
        </div>
        <h2
          {...title}
          className="mt-4 max-w-[560px] text-pretty text-[clamp(30px,4.4vw,42px)] font-semibold leading-[1.1] tracking-[-0.025em] text-ink"
        >
          La ley ya está del lado de la persona. Lo que falta es el trámite.
        </h2>
        <p {...body} className="mt-6 max-w-[520px] text-pretty text-muted">
          Nueve de cada diez tutelas de salud reclaman algo que el plan de beneficios ya
          cubría. El sistema no falla en la ley: falla en el papeleo. Y quien no sabe hacer
          el papeleo, se queda sin tratamiento.
        </p>
      </div>

      <div {...card} className="border border-line bg-surface p-6">
        <DotGrid />
      </div>
    </section>
  );
}

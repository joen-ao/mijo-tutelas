"use client";

import { CountUp } from "@/components/ui/count-up";
import { useReveal } from "@/components/ui/reveal";
import { useInView } from "@/hooks/use-in-view";

const TOTAL_CITES = 45;
const REJECTED = 4;

const CARDS = [
  {
    value: 100,
    suffix: "%",
    tone: "text-brand",
    label: "acierto en casos dentro de su alcance",
    note: "10/10 · etiqueta humana",
    delay: 0,
  },
  {
    value: 8.9,
    decimals: 1,
    suffix: "%",
    tone: "text-danger",
    label: "citas rechazadas por el verificador",
    note: "4 de 45",
    delay: 80,
  },
  {
    value: 41,
    tone: "text-brand-deep",
    label: "citas que llegaron al documento",
    note: "tras dos reintentos",
    delay: 160,
  },
];

function SegBar() {
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: "0px 0px -20% 0px" });

  return (
    <div ref={ref} aria-hidden className="grid grid-cols-15 gap-[5px]">
      {Array.from({ length: TOTAL_CITES }, (_, i) => (
        <div
          key={i}
          className="h-[26px] origin-bottom"
          style={{
            background: i < TOTAL_CITES - REJECTED ? "#cfe0d4" : "var(--color-danger)",
            transform: inView ? "scaleY(1)" : "scaleY(0)",
            transition: `transform .35s ease ${i * 12}ms`,
          }}
        />
      ))}
    </div>
  );
}

export function EvalResults() {
  const eyebrow = useReveal<HTMLDivElement>();
  const title = useReveal<HTMLHeadingElement>(60);
  const claim = useReveal<HTMLParagraphElement>();
  const note = useReveal<HTMLParagraphElement>();

  return (
    <section
      id="resultados"
      className="mx-auto max-w-[1200px] px-6 py-[88px] pin:px-10 pin:py-[96px]"
    >
      <div {...eyebrow} className="eyebrow">
        Resultados del eval
      </div>
      <h2
        {...title}
        className="mb-10 mt-3.5 max-w-[720px] text-pretty text-[clamp(30px,4.4vw,42px)] font-semibold leading-[1.1] tracking-[-0.025em] text-ink"
      >
        Diez casos con etiqueta humana, 45 citas propuestas, cuatro detenidas antes del
        juzgado.
      </h2>

      <div className="grid grid-cols-1 gap-5 pin:grid-cols-3">
        {CARDS.map((card) => (
          <Card key={card.label} {...card} />
        ))}
      </div>

      <div className="mt-14 grid grid-cols-1 items-center gap-12 pin:grid-cols-[52fr_48fr]">
        <div>
          <SegBar />
          <p className="mt-3.5 font-mono text-[11px] text-faint">
            45 citas propuestas · <span className="text-danger">4 rechazadas</span>
          </p>
        </div>
        <div>
          <p
            {...claim}
            className="text-pretty text-[27px] font-semibold leading-[1.25] tracking-[-0.02em] text-ink"
          >
            Casi 1 de cada 11 citas propuestas habría llegado a un juzgado como cita falsa.
          </p>
          <p className="mt-3 text-[15px] text-muted">
            Todos los rechazos fueron frases alteradas, no sentencias inventadas.
          </p>
        </div>
      </div>

      <p
        {...note}
        className="mt-10 max-w-[900px] text-pretty border border-dashed border-[#c9cfc8] px-[22px] py-5 text-sm leading-[1.6] text-muted"
      >
        El propio eval encontró un bug en el verificador, no en el modelo:{" "}
        <span className="font-mono">normalizarTexto()</span> rompía las citas buenas y
        descartaba una de cada tres. Corregido, con test de regresión. Se deja escrito
        porque es para eso que existe un eval.
      </p>
    </section>
  );
}

function Card({
  value,
  decimals,
  suffix,
  tone,
  label,
  note,
  delay,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  tone: string;
  label: string;
  note: string;
  delay: number;
}) {
  const card = useReveal<HTMLDivElement>(delay);

  return (
    <div
      {...card}
      className="border border-line bg-surface p-[26px] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-18px_rgba(18,66,32,0.45)]"
    >
      <CountUp
        value={value}
        decimals={decimals}
        suffix={suffix}
        className={`tabular-nums text-[clamp(36px,4.6vw,46px)] font-semibold leading-none tracking-[-0.03em] ${tone}`}
      />
      <p className="mt-2.5 text-[15px] text-muted">{label}</p>
      <p className="mt-1.5 font-mono text-[11px] text-faint">{note}</p>
    </div>
  );
}

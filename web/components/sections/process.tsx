"use client";

import { useRef, useState } from "react";
import { useFitViewport } from "@/hooks/use-fit-viewport";
import { usePinned } from "@/hooks/use-media-query";
import { useScrollProgress } from "@/hooks/use-scroll-progress";
import { clamp01 } from "@/lib/scroll";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    title: "Cuentas lo que pasó",
    body: "Escrito, en nota de voz o hablando por teléfono, como se lo contarías a alguien.",
  },
  {
    title: "Mijo ordena los hechos",
    body: "El relato se vuelve hechos numerados, con fechas y responsables.",
  },
  {
    title: "Busca jurisprudencia y la verifica",
    body: "Cada cita se comprueba contra el corpus antes de entrar.",
  },
  {
    title: "Recibes el PDF y lo radicamos",
    body: "Te llega por WhatsApp o por correo. Con tu autorización, va a la Oficina Judicial de Reparto.",
  },
];

const WAVE = [
  18, 34, 50, 26, 44, 58, 30, 20, 40, 54, 24, 36, 48, 22, 32, 46, 28, 16, 38, 52,
];

const AUDIO_SECONDS = 12;

const TRANSCRIPT =
  "A mi mamá le negaron la quimioterapia, la EPS dice que no está en el plan".split(" ");

const FACTS = [
  "El 2 de agosto de 2026, la EPS negó por escrito la quimioterapia ordenada por el médico tratante.",
  "La negativa se fundó en que el procedimiento no está en el plan de beneficios.",
  "La paciente tiene diagnóstico oncológico y el tratamiento no admite espera.",
  "Han transcurrido dos semanas sin que la EPS autorice la atención.",
];

const CITATIONS = [
  { id: "T-760/08", ok: true, verdict: "frase literal confirmada" },
  { id: "T-125/98", ok: false, verdict: "frase alterada, se elimina" },
  { id: "T-388/13", ok: true, verdict: "frase literal confirmada" },
];

/** Cada cita entra y, más tarde, se resuelve: primero se ve el chequeo, luego el fallo. */
const CITE_ENTERS = [0, 0.12, 0.24];
const CITE_RESOLVES = [0.48, 0.64, 0.8];

const DOCS = {
  tutela: {
    title: "Acción de tutela",
    body: "Respetuosamente acudo ante su despacho para solicitar el amparo del derecho fundamental a la salud de la señora María González, vulnerado por la negativa de la EPS a autorizar el tratamiento oncológico ordenado por su médico tratante. Con fundamento en los hechos numerados y en la jurisprudencia verificada que se cita, solicito ordenar la autorización inmediata del procedimiento y, dada la urgencia, decretar medida provisional.",
  },
  peticion: {
    title: "Derecho de petición",
    body: "Con fundamento en el artículo 23 de la Constitución y en la Ley 1755 de 2015, solicito respetuosamente a la EPS informar por escrito los motivos de la negativa del tratamiento oncológico ordenado por el médico tratante, indicar el fundamento normativo invocado y autorizar el procedimiento. La entidad cuenta con quince días hábiles para responder de fondo.",
  },
} as const;

type DocType = keyof typeof DOCS;

export function Process() {
  const [docType, setDocType] = useState<DocType>("tutela");

  return (
    <>
      <HowItWorks docType={docType} />
      <DocToggle value={docType} onChange={setDocType} />
    </>
  );
}

function HowItWorks({ docType }: { docType: DocType }) {
  const pinned = usePinned();
  const wrapRef = useRef<HTMLElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);

  // 400 pasos de cuantización: 100 por cada uno de los cuatro tramos, suficiente
  // para que el cabezal del audio y el revelado de palabras se vean continuos.
  const progress = useScrollProgress(wrapRef, pinned, 400);
  useFitViewport(fitRef, pinned);

  const scaled = progress * 4;
  const active = Math.min(4, Math.max(1, Math.floor(progress * 4.001) + 1));
  // Avance dentro del paso activo, comprimido a 0.7 para que el visual termine
  // antes del cambio de paso y quede un momento de lectura.
  const step = clamp01((scaled - (active - 1)) / 0.7);
  const localFor = (index: number) => (active === index ? step : 0);

  return (
    <section
      id="como-funciona"
      ref={wrapRef}
      className="relative border-y border-line bg-surface pin:h-[260vh]"
    >
      <div className="flex items-center overflow-visible py-[88px] pin:sticky pin:top-0 pin:h-screen pin:overflow-hidden pin:py-0">
        <div
          ref={fitRef}
          className="mx-auto grid w-full max-w-[1200px] grid-cols-1 items-center gap-14 px-6 pin:grid-cols-[42fr_58fr] pin:px-10"
        >
          <div>
            <div className="eyebrow">Cómo funciona</div>
            <h2 className="mb-[30px] mt-3.5 text-pretty text-[clamp(28px,4vw,38px)] font-semibold leading-[1.12] tracking-[-0.025em] text-ink">
              De una nota de voz a un documento radicable.
            </h2>

            {/* Riel de avance: en una sección anclada, saber cuánto falta. */}
            <div className="relative">
              <span aria-hidden className="absolute left-0 top-0 h-full w-px bg-line" />
              <span
                aria-hidden
                className="absolute left-0 top-0 w-px bg-brand"
                style={{ height: `${(progress * 100).toFixed(1)}%` }}
              />

              <ol className="flex flex-col gap-4 pl-6">
                {STEPS.map((s, i) => {
                  const on = active === i + 1;
                  return (
                    <li
                      key={s.title}
                      className="flex gap-3.5 transition-[opacity,transform] duration-300"
                      style={{
                        opacity: on ? 1 : 0.35,
                        transform: on ? "translateX(4px)" : "none",
                      }}
                    >
                      <span className="pt-1 font-mono text-xs text-brand">0{i + 1}</span>
                      <div>
                        <h3 className="text-[19px] font-semibold text-ink">{s.title}</h3>
                        <p className="text-[14.5px] text-muted">{s.body}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>

          {/* Los cuatro visuales se apilan en la misma celda: el panel mide lo que
              mide el más alto, sin altura fija que sobre. */}
          <div className="grid border border-line bg-canvas">
            <Visual on={active === 1}>
              <Transcription p={localFor(1)} />
            </Visual>

            <Visual on={active === 2}>
              <Facts p={localFor(2)} />
            </Visual>

            <Visual on={active === 3}>
              <Citations p={localFor(3)} />
            </Visual>

            <Visual on={active === 4} center>
              <Document p={localFor(4)} doc={DOCS[docType]} />
            </Visual>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Paso 1: el audio se reproduce y la transcripción aparece detrás del cabezal. */
function Transcription({ p }: { p: number }) {
  const head = p * WAVE.length;
  const words = Math.round(p * TRANSCRIPT.length);
  const seconds = Math.round(p * AUDIO_SECONDS);

  return (
    <div className="flex flex-col justify-center gap-[22px]">
      <div className="flex items-center gap-4">
        <div aria-hidden className="flex h-[60px] items-center gap-[3px]">
          {WAVE.map((height, i) => {
            const played = i < head;
            const onHead = played && i > head - 1.8;
            return (
              <span
                key={i}
                className="w-[3px] rounded-[2px]"
                style={{
                  height,
                  background: played ? "var(--color-brand)" : "#ccd5cd",
                  transform: `scaleY(${onHead ? 1.28 : played ? 1 : 0.7})`,
                  transition: "background-color .2s ease, transform .2s ease",
                }}
              />
            );
          })}
        </div>
        <span className="font-mono text-[11px] tabular-nums text-faint">
          0:{String(seconds).padStart(2, "0")} / 0:{AUDIO_SECONDS}
        </span>
      </div>

      <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-faint">
        transcripción
      </div>

      <p className="text-pretty font-serif text-[21px] leading-[1.5] text-ink">
        {TRANSCRIPT.map((word, i) => (
          <span
            key={i}
            style={{ opacity: i < words ? 1 : 0.14, transition: "opacity .2s ease" }}
          >
            {word}{" "}
          </span>
        ))}
      </p>
    </div>
  );
}

/** Paso 2: el relato se ordena en hechos, uno tras otro. */
function Facts({ p }: { p: number }) {
  const shown = p * (FACTS.length + 0.4);

  return (
    <div className="flex flex-col justify-center gap-3.5">
      <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-faint">
        hechos
      </div>
      {FACTS.map((fact, i) => {
        const on = shown > i;
        return (
          <div
            key={i}
            className="flex gap-3.5 font-serif text-[15.5px] leading-[1.5] text-ink"
            style={{
              opacity: on ? 1 : 0,
              transform: on ? "none" : "translateX(-12px)",
              transition: "opacity .3s ease, transform .3s cubic-bezier(.22,.61,.36,1)",
            }}
          >
            <span className="font-mono text-xs text-brand">{i + 1}.</span>
            <span>{fact}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Paso 3: las citas entran «comprobando» y solo después se resuelven. */
function Citations({ p }: { p: number }) {
  return (
    <div className="flex flex-col justify-center gap-3">
      <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-faint">
        candidatas
      </div>
      {CITATIONS.map((cite, i) => {
        const entered = p > CITE_ENTERS[i];
        const resolved = p > CITE_RESOLVES[i];
        const rejected = resolved && !cite.ok;

        return (
          <div
            key={cite.id}
            className="flex items-center gap-3 border bg-white px-[15px] py-[13px]"
            style={{
              opacity: entered ? 1 : 0,
              transform: entered ? "none" : "translateY(10px)",
              borderColor: resolved
                ? cite.ok
                  ? "rgba(26,92,46,0.4)"
                  : "rgba(214,69,69,0.45)"
                : "var(--color-line)",
              transition:
                "opacity .3s ease, transform .3s cubic-bezier(.22,.61,.36,1), border-color .3s ease",
            }}
          >
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] text-white"
              style={{
                background: resolved
                  ? cite.ok
                    ? "var(--color-brand)"
                    : "var(--color-danger)"
                  : "transparent",
                border: resolved ? "0" : "1px solid var(--color-faint)",
                transform: resolved ? "scale(1)" : "scale(.72)",
                transition: "background-color .25s ease, transform .25s ease",
              }}
            >
              {resolved ? (cite.ok ? "✓" : "×") : ""}
            </span>

            <span
              className="font-serif text-[15px]"
              style={{
                color: rejected ? "var(--color-faint)" : "var(--color-ink)",
                textDecoration: rejected ? "line-through" : "none",
                transition: "color .3s ease",
              }}
            >
              {cite.id} —{" "}
              <span
                style={{
                  opacity: resolved ? 1 : 0.55,
                  transition: "opacity .25s ease",
                }}
              >
                {resolved ? cite.verdict : "comprobando contra el corpus…"}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Máscara de escritura: sólido hasta `edge`, difuminado en los 16% siguientes. */
function writingMask(reveal: number) {
  const edge = reveal * 118 - 18;
  const gradient = `linear-gradient(to bottom, #000 ${edge.toFixed(1)}%, transparent ${(edge + 16).toFixed(1)}%)`;
  return { WebkitMaskImage: gradient, maskImage: gradient };
}

/** Paso 4: el documento se escribe de arriba abajo y al final se sella. */
function Document({
  p,
  doc,
}: {
  p: number;
  doc: (typeof DOCS)[DocType];
}) {
  const bodyReveal = clamp01((p - 0.12) / 0.55);
  const sealed = p > 0.85;

  return (
    <div
      className="w-full max-w-[400px] border border-line bg-white px-8 py-[30px] font-serif"
      style={{
        opacity: p > 0.02 ? 1 : 0,
        transform: p > 0.02 ? "none" : "translateY(10px)",
        transition: "opacity .3s ease, transform .3s cubic-bezier(.22,.61,.36,1)",
      }}
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-faint">
        Juzgado de reparto — Medellín
      </div>

      <div
        className="mt-3.5 text-[19px] font-semibold text-ink"
        style={{
          opacity: p > 0.08 ? 1 : 0,
          transition: "opacity .25s ease",
        }}
      >
        {doc.title}
      </div>

      {/* Se descubre de arriba abajo, como si se estuviera redactando. El borde
          va difuminado: un corte duro a media línea parece un error de render. */}
      <p
        className="mt-3 text-[12.5px] leading-[1.65] text-muted pin:text-justify"
        style={{ ...writingMask(bodyReveal) }}
      >
        {doc.body}
      </p>

      <div
        className="mt-4 inline-flex items-center gap-2 border border-brand px-2.5 py-1.5 font-mono text-[10px] text-brand-deep"
        style={{
          opacity: sealed ? 1 : 0,
          transform: sealed ? "scale(1)" : "scale(.92)",
          transition: "opacity .25s ease, transform .25s ease",
        }}
      >
        <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-brand text-[8px] text-white">
          ✓
        </span>
        citas verificadas contra el corpus
      </div>
    </div>
  );
}

function Visual({
  on,
  center,
  children,
}: {
  on: boolean;
  center?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-hidden={!on}
      className={cn(
        "col-start-1 row-start-1 flex flex-col justify-center p-[34px] transition-[opacity,transform] duration-[350ms]",
        center && "items-center",
      )}
      style={{
        opacity: on ? 1 : 0,
        transform: on ? "none" : "translateY(14px)",
        pointerEvents: on ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}

function DocToggle({
  value,
  onChange,
}: {
  value: DocType;
  onChange: (next: DocType) => void;
}) {
  const options: { key: DocType; label: string }[] = [
    { key: "tutela", label: "Tutela" },
    { key: "peticion", label: "Derecho de petición" },
  ];

  return (
    <section className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-5 px-6 pb-[96px] pt-10 pin:px-10">
      <div className="inline-flex gap-1 rounded-md border border-line bg-surface p-1">
        {options.map((option) => {
          const on = option.key === value;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(option.key)}
              className={cn(
                "cursor-pointer rounded-[4px] px-[18px] py-[9px] text-sm font-semibold transition-colors duration-150",
                on ? "bg-brand text-white" : "bg-transparent text-muted hover:text-ink",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="max-w-[620px] text-pretty text-[14.5px] text-muted">
        El sistema decide cuál de los dos corresponde antes de escribir una línea: si nunca
        le pediste nada formal a la EPS, la tutela todavía no es el paso.
      </p>
    </section>
  );
}

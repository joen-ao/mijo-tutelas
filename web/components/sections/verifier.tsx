"use client";

import { useRef } from "react";
import { useFitViewport } from "@/hooks/use-fit-viewport";
import { usePinned, useReducedMotion } from "@/hooks/use-media-query";
import { useScrollProgress } from "@/hooks/use-scroll-progress";

const LEAD =
  "La jurisprudencia constitucional ha sostenido que la negativa de una EPS a autorizar procedimientos ordenados por el médico tratante vulnera el derecho fundamental a la salud, incluso cuando la entidad alega que no están cubiertos, según".split(
    " ",
  );
const CITE = "la sentencia T-125/98".split(" ");
const TOTAL_WORDS = LEAD.length + CITE.length + 1;

export function Verifier() {
  const pinned = usePinned();
  const reduced = useReducedMotion();
  const wrapRef = useRef<HTMLElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);

  const p = useScrollProgress(wrapRef, pinned);
  useFitViewport(fitRef, pinned);

  const revealed = reduced
    ? TOTAL_WORDS
    : Math.floor(Math.min(1, p / 0.2) * TOTAL_WORDS);

  const word = (index: number) => ({
    opacity: revealed > index ? 1 : 0.12,
    transition: "opacity .18s ease",
  });

  const step = (on: boolean, shift = 8) => ({
    opacity: on ? 1 : 0,
    transform: on ? "none" : `translateY(${shift}px)`,
    transition: "opacity .3s ease, transform .3s ease",
  });

  const citeHidden = p > 0.9;

  return (
    <section
      id="verificador"
      ref={wrapRef}
      className="relative bg-night pin:h-[340vh]"
    >
      <div className="flex items-center overflow-visible py-[88px] pin:sticky pin:top-0 pin:h-screen pin:overflow-hidden pin:py-0">
        <div ref={fitRef} className="mx-auto w-full max-w-[1200px] px-6 pin:px-10">
          <div className="eyebrow eyebrow-night">El diferenciador</div>
          <h2 className="mt-3.5 max-w-[780px] text-pretty text-[clamp(30px,4.4vw,42px)] font-semibold leading-[1.1] tracking-[-0.025em] text-white">
            Un asistente jurídico se cae siempre en el mismo punto: inventa una sentencia.
          </h2>
          <p className="mt-4 font-mono text-[15px] text-brand-bright">
            El modelo emite juicios. El código emite hechos.
          </p>

          <div className="mt-[34px] grid grid-cols-1 items-start gap-10 pin:grid-cols-[55fr_45fr]">
            {/* Borrador del modelo */}
            <div className="border-l-2 border-white/15 pl-[22px]">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-night-faint">
                fundamento jurídico · borrador del modelo
              </div>
              {/* Justificado solo en anchos donde no abre ríos entre palabras. */}
              <p className="mt-3 text-pretty font-serif text-[19px] leading-[1.65] text-night-text pin:text-justify">
                {LEAD.map((w, i) => (
                  <span key={i} style={word(i)}>
                    {w}{" "}
                  </span>
                ))}
                <span
                  style={{
                    display: citeHidden ? "none" : "inline",
                    borderBottom: `2px solid ${p > 0.2 ? "var(--color-brand-bright)" : "transparent"}`,
                    opacity: p > 0.86 ? 0 : 1,
                    transition:
                      "border-color .3s ease, opacity .3s ease, background-color .3s ease",
                  }}
                >
                  {CITE.map((w, i) => (
                    <span key={i} style={word(LEAD.length + i)}>
                      {w}
                      {i < CITE.length - 1 ? " " : ""}
                    </span>
                  ))}
                </span>
                <span
                  className="font-mono text-[13px] text-danger"
                  style={{
                    display: citeHidden ? "inline" : "none",
                    borderBottom: "1px dashed var(--color-danger)",
                  }}
                >
                  [fundamento sin cita]
                </span>
                <span style={word(TOTAL_WORDS - 1)}>.</span>
              </p>

              {/* Ocupa el hueco que dejaba el párrafo y cierra el argumento en su sitio. */}
              <blockquote className="mt-8 border-t border-white/12 pt-7 text-pretty font-serif text-[clamp(19px,1.7vw,23px)] leading-[1.42] text-night-text">
                Preferimos una tutela con una cita menos que una con una cita falsa. La
                primera es más débil; la segunda le explota en la cara a la persona frente
                al juez.
              </blockquote>
            </div>

            {/* Verificador */}
            <div className="border border-white/12 bg-white/[0.04] p-[22px]">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-night-faint">
                verificador · código determinista
              </div>

              <div className="mt-4" style={step(p > 0.28, 10)}>
                <div className="grid grid-cols-[84px_1fr] gap-x-3 gap-y-2 font-mono text-[12.5px]">
                  <div className="text-night-faint">sentencia</div>
                  <div className="text-white">T-125/98</div>
                  <div className="text-night-faint">frase</div>
                  <div className="font-serif text-[14.5px] leading-[1.45] text-white">
                    «…{" "}
                    <span
                      style={{
                        backgroundColor: p > 0.64 ? "rgba(214,69,69,0.35)" : "transparent",
                        color: p > 0.64 ? "#ffd9d9" : "#ffffff",
                        transition: "background-color .3s ease, color .3s ease",
                      }}
                    >
                      quimioterapia y radioterapia para el cáncer
                    </span>{" "}
                    …»
                  </div>
                </div>
              </div>

              <Check
                on={p > 0.42}
                marked={p > 0.44}
                ok
                label="¿el id existe en el corpus?"
                className="mt-[18px]"
              />
              <Check
                on={p > 0.52}
                marked={p > 0.6}
                ok={false}
                label="¿la frase está literal en la sentencia?"
                className="mt-2.5"
              />

              <div className="mt-4 bg-black/25 px-3.5 py-[13px]" style={step(p > 0.58)}>
                <div className="font-mono text-[10.5px] text-night-faint">
                  texto real de T-125/98
                </div>
                <div className="mt-1.5 font-serif text-[14.5px] leading-[1.45] text-night-text">
                  «… <span className="text-brand-bright">transporte renal, diálisis, neurocirugía</span> …»
                </div>
              </div>

              <div
                className="mt-[18px] inline-flex items-center gap-2 bg-danger px-3.5 py-2 font-mono text-[11.5px] tracking-[0.06em] text-white"
                style={{
                  opacity: p > 0.74 ? 1 : 0,
                  transform: p > 0.74 ? "scale(1)" : "scale(.85)",
                  transition: "opacity .25s ease, transform .25s cubic-bezier(.2,1.4,.4,1)",
                }}
              >
                RECHAZADA · frase_no_literal
              </div>

              <p className="mt-[18px] text-base text-white" style={step(p > 0.9)}>
                Se lee perfecto. Cita una sentencia que existe. Y es falsa.
              </p>
            </div>
          </div>

          <p className="mt-[34px] max-w-[760px] text-pretty text-[15px] leading-[1.6] text-night-soft">
            El verificador es código determinista, sin LLM: compara el id contra el corpus y
            la frase carácter por carácter contra el texto de la sentencia. Dos reintentos;
            si sigue fallando, la cita se elimina y el fundamento queda marcado como hueco.
          </p>
        </div>
      </div>
    </section>
  );
}

function Check({
  on,
  marked,
  ok,
  label,
  className,
}: {
  on: boolean;
  marked: boolean;
  ok: boolean;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 ${className ?? ""}`}
      style={{
        opacity: on ? 1 : 0,
        transform: on ? "none" : "translateY(8px)",
        transition: "opacity .3s ease, transform .3s ease",
      }}
    >
      <span
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] text-white ${
          ok ? "bg-brand" : "bg-danger"
        }`}
        style={{
          transform: marked ? "scale(1)" : "scale(.4)",
          transition: "transform .3s ease",
        }}
      >
        {ok ? "✓" : "×"}
      </span>
      <span className="font-mono text-[12.5px] text-night-muted">{label}</span>
    </div>
  );
}

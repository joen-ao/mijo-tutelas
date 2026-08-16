"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PhoneCta, WhatsAppCta } from "@/components/ui/whatsapp-cta";
import { useReveal } from "@/components/ui/reveal";
import { useInView } from "@/hooks/use-in-view";
import { useReducedMotion } from "@/hooks/use-media-query";

const CEDULA = "43815226";
const KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const VOICE_BARS = [7, 14, 20, 11, 17, 24, 13, 9, 19, 22, 12, 16, 21, 10, 15];

type Turn =
  | { who: "mijo" | "tu"; kind: "habla"; text: string }
  | { who: "tu"; kind: "voz"; text: string }
  | { who: "tu"; kind: "teclado" }
  | { who: "tu"; kind: "deletreo"; text: string }
  | { who: "mijo"; kind: "cierre"; text: string }
  | { who: "mijo"; kind: "entrega" };

const TURNS: Turn[] = [
  { who: "mijo", kind: "habla", text: "Hola, soy Mijo. Cuéntame qué te negó tu EPS." },
  {
    who: "tu",
    kind: "voz",
    text: "No me autorizan la quimioterapia de mi mamá, llevo ocho meses.",
  },
  {
    who: "mijo",
    kind: "habla",
    text: "Entendido. Marca tu número de cédula en el teclado y termina con la tecla numeral.",
  },
  { who: "tu", kind: "teclado" },
  { who: "mijo", kind: "habla", text: "Ahora deletréame tu correo, letra por letra." },
  { who: "tu", kind: "deletreo", text: "eme · a · erre · i · a · arroba · ce · o · erre · erre · e · o" },
  {
    who: "mijo",
    kind: "cierre",
    text: "Listo, te lo acabo de enviar. No necesitas abogado y no tienes que pagar nada.",
  },
  { who: "mijo", kind: "entrega" },
];

export function PhoneChannel() {
  const eyebrow = useReveal<HTMLDivElement>();
  const title = useReveal<HTMLHeadingElement>(60);
  const lead = useReveal<HTMLParagraphElement>(120);
  const modes = useReveal<HTMLDListElement>(160);

  return (
    <section id="telefono" className="scroll-mt-[84px] border-y border-line bg-surface">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-start gap-14 px-6 py-[96px] pin:grid-cols-[48fr_52fr] pin:px-10">
        <div>
          <div {...eyebrow} className="eyebrow">
            Sin datos, sin pantalla
          </div>

          <h2
            {...title}
            className="mt-3.5 max-w-[560px] text-pretty text-[clamp(30px,4.4vw,42px)] font-semibold leading-[1.1] tracking-[-0.025em] text-ink"
          >
            La justicia no debería exigir saber usar WhatsApp.
          </h2>

          <p {...lead} className="mt-6 max-w-[520px] text-pretty text-muted">
            Entregar solo por WhatsApp deja afuera justo a quien más lo necesita: el adulto
            mayor con un teléfono básico, sin datos, que lleva ocho meses peleando con su
            EPS. Esa persona es la usuaria del producto, no un caso borde.
          </p>

          <dl {...modes} className="mt-9 flex flex-col gap-7">
            <div>
              <dt className="font-mono text-xs font-semibold tracking-[0.12em] text-brand">
                «LLÁMAME»
              </dt>
              <dd className="mt-2.5 text-pretty text-[16.5px] leading-[1.5] text-ink">
                Si ya tienes tu tutela, escribes <em className="not-italic font-semibold">llámame</em> y
                Mijo te llama para leértela en voz alta: qué se pidió, a qué juzgado ir y
                —repetido al final a propósito— que no necesitas abogado ni pagar nada.
              </dd>
            </div>

            <div>
              <dt className="font-mono text-xs font-semibold tracking-[0.12em] text-brand">
                LA LLAMADA COMPLETA
              </dt>
              <dd className="mt-2.5 text-pretty text-[16.5px] leading-[1.5] text-ink">
                Si no tienes WhatsApp, todo ocurre por teléfono. Mijo pregunta, tú
                respondes hablando, marcas tu cédula en el teclado y deletreas tu correo.
                El documento llega por email sin que hayas tocado una pantalla.
              </dd>
            </div>
          </dl>

          <div className="mt-9 flex flex-wrap gap-3">
            <PhoneCta variant="solid" />
            <WhatsAppCta variant="outline">Prefiero escribir</WhatsAppCta>
          </div>
        </div>

        <CallDemo />
      </div>
    </section>
  );
}

function CallDemo() {
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: "0px 0px -10% 0px" });
  const reduced = useReducedMotion();

  const [visible, setVisible] = useState(0);
  const [digits, setDigits] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const run = useCallback(() => {
    clearTimers();

    const at = (fn: () => void, delay: number) => {
      timers.current.push(setTimeout(fn, delay));
    };

    if (reduced) {
      at(() => {
        setVisible(TURNS.length);
        setDigits(CEDULA.length + 1);
        setSeconds(52);
        setRunning(false);
      }, 0);
      return;
    }

    at(() => {
      setVisible(0);
      setDigits(0);
      setSeconds(0);
      setRunning(true);
    }, 0);

    let t = 300;
    TURNS.forEach((turn, i) => {
      const count = i + 1;
      at(() => setVisible(count), t);

      if (turn.kind === "teclado") {
        // Las teclas se marcan una a una, como quien busca los números.
        for (let d = 1; d <= CEDULA.length + 1; d += 1) {
          at(() => setDigits(d), t + 260 + d * 230);
        }
        t += 260 + (CEDULA.length + 1) * 230 + 500;
      } else {
        t += turn.kind === "entrega" ? 900 : 1750;
      }
    });

    at(() => setRunning(false), t);
  }, [clearTimers, reduced]);

  useEffect(() => {
    if (!inView) return;
    run();
    return clearTimers;
  }, [inView, run, clearTimers]);

  // El contador solo corre mientras la llamada está activa.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const typed = CEDULA.slice(0, Math.min(digits, CEDULA.length));
  const activeKey =
    digits > 0 ? (digits > CEDULA.length ? "#" : CEDULA[digits - 1]) : null;

  return (
    <div ref={ref} className="border border-line bg-white">
      {/* Barra de llamada */}
      <div className="flex items-center gap-3 bg-brand-deep px-5 py-3.5 text-white">
        {/* El punto solo está vivo mientras la llamada lo está. */}
        <span
          aria-hidden
          className={`h-2 w-2 flex-none rounded-full ${
            running ? "animate-pulse bg-brand-bright" : "bg-white/30"
          }`}
        />
        <div className="leading-[1.2]">
          <div className="text-[14.5px] font-semibold">Mijo</div>
          <div className="text-[11px] text-white/70">
            {running ? "llamada en curso" : "llamada finalizada"}
          </div>
        </div>
        <span className="ml-auto font-mono text-[13px] tabular-nums text-white/85">
          {mm}:{ss}
        </span>
      </div>

      <div className="flex flex-col gap-5 p-5 pin:p-6">
        {TURNS.slice(0, visible).map((turn, i) => (
          <div key={i} className="bubble-in flex gap-3.5">
            <span className="w-9 flex-none pt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
              {turn.who === "mijo" ? "Mijo" : "Tú"}
            </span>

            <div className="min-w-0 flex-1">
              {turn.kind === "voz" ? (
                <div className="flex items-center gap-3">
                  <div aria-hidden className="flex h-6 items-center gap-[2px]">
                    {VOICE_BARS.map((h, k) => (
                      <span
                        key={k}
                        className="w-[2px] rounded-[1px] bg-brand"
                        style={{ height: h }}
                      />
                    ))}
                  </div>
                  <p className="text-[15px] italic leading-[1.5] text-muted">
                    «{turn.text}»
                  </p>
                </div>
              ) : null}

              {turn.kind === "teclado" ? (
                <div className="flex flex-wrap items-center gap-5">
                  <div aria-hidden className="grid w-[132px] grid-cols-3 gap-1.5">
                    {KEYPAD.map((key) => {
                      const on = key === activeKey;
                      return (
                        <span
                          key={key}
                          className="flex h-9 items-center justify-center rounded-[3px] border font-mono text-[13px] transition-colors duration-150"
                          style={{
                            borderColor: on ? "var(--color-brand)" : "var(--color-line)",
                            background: on ? "var(--color-brand)" : "var(--color-canvas)",
                            color: on ? "#ffffff" : "var(--color-muted)",
                          }}
                        >
                          {key}
                        </span>
                      );
                    })}
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                      cédula
                    </div>
                    <div className="mt-1 font-mono text-[17px] tabular-nums tracking-[0.14em] text-ink">
                      {typed || "—"}
                      {digits > CEDULA.length ? (
                        <span className="text-brand"> #</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {turn.kind === "deletreo" ? (
                <p className="font-mono text-[13.5px] leading-[1.6] text-ink">
                  {turn.text}
                </p>
              ) : null}

              {turn.kind === "habla" ? (
                <p className="text-pretty text-[15px] leading-[1.5] text-ink">{turn.text}</p>
              ) : null}

              {turn.kind === "cierre" ? (
                <>
                  <p className="text-pretty text-[15px] leading-[1.5] text-ink">
                    {turn.text}
                  </p>
                  <p className="mt-1.5 font-mono text-[10.5px] leading-[1.5] text-faint">
                    se repite al final a propósito: es lo que más se olvida
                  </p>
                </>
              ) : null}

              {turn.kind === "entrega" ? (
                <div className="flex items-center gap-3 rounded-[7px] border border-line bg-canvas px-3 py-2.5">
                  <div className="flex h-8 w-[26px] flex-none items-center justify-center rounded-[2px] border border-danger bg-white font-mono text-[8px] text-danger">
                    PDF
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[11px] text-ink">
                      tutela-maria-gonzalez.pdf
                    </div>
                    <div className="truncate font-mono text-[10px] text-faint">
                      enviado a maria@correo.com
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
        <span className="font-mono text-[10.5px] text-faint">
          sin datos · sin app · teléfono básico
        </span>
        <button
          type="button"
          onClick={run}
          className="cursor-pointer rounded-[20px] border border-[#d8ddd6] px-3 py-[5px] text-[11px] text-muted transition-colors duration-150 hover:border-brand hover:text-brand"
        >
          repetir
        </button>
      </div>
    </div>
  );
}

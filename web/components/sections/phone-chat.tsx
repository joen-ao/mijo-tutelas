"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useInView } from "@/hooks/use-in-view";
import { useReducedMotion } from "@/hooks/use-media-query";

const WAVE_BARS = [6, 12, 17, 9, 14, 20, 11, 7, 15, 19, 10, 13, 18, 8, 12, 16, 6, 14];

/** Lados en el orden en que entran los mensajes. Debe cuadrar con `messages`. */
const SIDES = ["out", "in", "out", "in", "in", "in", "in"] as const;
const TOTAL = SIDES.length;

export function PhoneChat() {
  const { ref: viewRef, inView } = useInView<HTMLDivElement>({ rootMargin: "0px" });
  const reduced = useReducedMotion();

  const threadRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(0);
  const [typing, setTyping] = useState(false);
  const [barsLit, setBarsLit] = useState(false);
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
        setVisible(TOTAL);
        setTyping(false);
        setBarsLit(true);
      }, 0);
      return;
    }

    // La secuencia entera vive en timers, incluido el estado inicial: así
    // `run` puede llamarse desde un efecto sin encadenar renders.
    at(() => {
      setVisible(0);
      setTyping(false);
      setBarsLit(false);
    }, 0);

    // La nota de voz entra casi de inmediato: es la burbuja que sostiene la página.
    let t = 120;
    at(() => setVisible(1), t);

    t += 180;
    at(() => setBarsLit(true), t);
    // Las barras se encienden en cascada vía transition-delay.
    t += WAVE_BARS.length * 25 + 130;

    for (let i = 1; i < TOTAL; i += 1) {
      if (SIDES[i] === "in") {
        at(() => setTyping(true), t);
        t += 1100;
        at(() => setTyping(false), t);
        t += 110;
      } else {
        t += 420;
      }
      const count = i + 1;
      at(() => setVisible(count), t);
      t += 620;
    }

    at(() => setBarsLit(false), t + 800);
  }, [clearTimers, reduced]);

  useEffect(() => {
    if (!inView) return;
    run();
    return clearTimers;
  }, [inView, run, clearTimers]);

  // Como en WhatsApp: el hilo crece hacia abajo y persigue el último mensaje.
  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTo({
      top: thread.scrollHeight,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [visible, typing, reduced]);

  const messages = [
    <VoiceNote key="voz" barsLit={barsLit} />,
    <InBubble key="ciudad" time="10:42">
      Entiendo, y eso no debería pasar. ¿Hace cuánto se la negaron y en qué ciudad estás?
    </InBubble>,
    <OutBubble key="medellin" time="10:43">
      Hace como dos semanas, en Medellín
    </OutBubble>,
    <InBubble key="triaje" time="10:43">
      Como todavía no le has pedido nada por escrito a la EPS, primero mando un derecho de
      petición: tienen 15 días hábiles para responderte.
    </InBubble>,
    <InBubble key="urgencia" time="10:43">
      Listo. Tu caso es urgente, así que voy a pedir medida provisional para que el juez
      ordene la atención de inmediato.
    </InBubble>,
    <InBubble key="pdf" time="10:44" read>
      Ya está.
      <div className="mt-[7px] flex items-center gap-[9px] rounded-[7px] border border-line bg-canvas px-[9px] py-2">
        <div className="flex h-8 w-[26px] items-center justify-center rounded-[2px] border border-danger bg-white font-mono text-[8px] text-danger">
          PDF
        </div>
        <div className="min-w-0">
          <div className="truncate font-mono text-[10.5px] text-ink">
            tutela-maria-gonzalez.pdf
          </div>
          <div className="font-mono text-[10px] text-faint">184 KB</div>
        </div>
      </div>
    </InBubble>,
    <InBubble key="radicar" time="10:44" read>
      ¿Quieres que la radique por ti ante la Oficina Judicial de Reparto de Medellín?
    </InBubble>,
  ];

  return (
    <div
      ref={viewRef}
      className="relative w-[336px] max-w-full rounded-[46px] bg-[#1c1f1d] p-3 shadow-[0_30px_60px_-30px_rgba(18,66,32,0.45),0_0_0_1px_rgba(0,0,0,0.06)]"
    >
      <div className="absolute left-1/2 top-5 z-[4] h-[22px] w-[92px] -translate-x-1/2 rounded-xl bg-[#1c1f1d]" />

      <div className="flex h-[620px] flex-col overflow-hidden rounded-[36px] bg-[#ece7df]">
        {/* Barra de conversación */}
        <div className="flex flex-none items-center gap-2.5 bg-brand-deep px-3.5 pb-3 pt-[30px] text-white">
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-brand-bright text-sm font-bold text-[#06170e]">
            M
          </div>
          <div className="leading-[1.2]">
            <div className="text-[14.5px] font-semibold">Mijo</div>
            <div className="text-[11px] text-white/70">en línea</div>
          </div>
        </div>

        {/* Hilo */}
        <div
          ref={threadRef}
          className="no-scrollbar flex min-h-0 flex-1 flex-col justify-start gap-2 overflow-y-auto px-3 py-3.5"
        >
          {messages.slice(0, visible)}

          {typing ? (
            <div
              className="flex items-center gap-1 self-start rounded-[10px_10px_10px_2px] bg-white px-[13px] py-[11px]"
              aria-hidden
            >
              {[0, 0.15, 0.3].map((delay) => (
                <span
                  key={delay}
                  className="h-[5px] w-[5px] rounded-full bg-muted"
                  style={{ animation: `mj-dot 1.1s ${delay}s infinite` }}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-none justify-center px-3 pb-3 pt-2">
          <button
            type="button"
            onClick={run}
            className="cursor-pointer rounded-[20px] border border-[#d8ddd6] bg-white/80 px-3 py-[5px] text-[11px] text-muted transition-colors duration-150 hover:border-brand hover:text-brand"
          >
            repetir
          </button>
        </div>
      </div>
    </div>
  );
}

function VoiceNote({ barsLit }: { barsLit: boolean }) {
  return (
    <div className="bubble-in max-w-[250px] flex-none self-end">
      <div className="rounded-[10px_10px_2px_10px] bg-bubble px-[11px] py-[9px]">
        <div className="flex items-center gap-2">
          <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-brand text-[9px] text-white">
            ▶
          </div>
          <div className="flex h-5 items-center gap-[2px]">
            {WAVE_BARS.map((height, i) => (
              <span
                key={i}
                className="w-[2px] rounded-[1px]"
                style={{
                  height,
                  background: barsLit ? "var(--color-brand)" : "#7fa98c",
                  transition: "background-color .12s linear",
                  transitionDelay: barsLit ? `${i * 25}ms` : "0ms",
                }}
              />
            ))}
          </div>
          <div className="font-mono text-[10.5px] text-[#4c6b56]">0:12</div>
        </div>
        <div className="mt-[3px] text-right text-[9.5px] text-[#6d8a78]">10:42</div>
      </div>
      <p className="mt-[5px] text-right text-[11.5px] italic leading-[1.4] text-[#7d8279]">
        «A mi mamá le negaron la quimioterapia, la EPS dice que no está en el plan»
      </p>
    </div>
  );
}

function InBubble({
  time,
  read,
  children,
}: {
  time: string;
  read?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bubble-in max-w-[252px] flex-none self-start rounded-[10px_10px_10px_2px] bg-white px-[11px] py-[9px] text-[13.5px] leading-[1.4]">
      {children}
      <div className="mt-[3px] text-right text-[9.5px] text-[#a2a8a0]">
        {time} {read ? <span className="text-[#34b7f1]">✓✓</span> : null}
      </div>
    </div>
  );
}

function OutBubble({ time, children }: { time: string; children: React.ReactNode }) {
  return (
    <div className="bubble-in max-w-[240px] flex-none self-end rounded-[10px_10px_2px_10px] bg-bubble px-[11px] py-[9px] text-[13.5px] leading-[1.4]">
      {children}
      <div className="mt-[3px] text-right text-[9.5px] text-[#6d8a78]">{time}</div>
    </div>
  );
}

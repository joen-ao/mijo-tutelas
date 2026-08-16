"use client";

import { useEffect, useRef } from "react";
import { PhoneChat } from "@/components/sections/phone-chat";
import { useReveal } from "@/components/ui/reveal";
import { GhostLink, WhatsAppCta } from "@/components/ui/whatsapp-cta";
import { useReducedMotion } from "@/hooks/use-media-query";
import { usePointerGlow } from "@/hooks/use-pointer-glow";
import { onScrollFrame } from "@/lib/scroll";

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  usePointerGlow(sectionRef);

  const eyebrow = useReveal<HTMLDivElement>();
  const title = useReveal<HTMLHeadingElement>(60);
  const lead = useReveal<HTMLParagraphElement>(120);
  const actions = useReveal<HTMLDivElement>(180);
  const legal = useReveal<HTMLDivElement>(240);

  const phoneRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const el = phoneRef.current;
    if (!el) return;
    return onScrollFrame(() => {
      const rect = el.getBoundingClientRect();
      const offset = Math.max(
        -40,
        Math.min(40, (window.innerHeight / 2 - (rect.top + rect.height / 2)) * 0.08),
      );
      el.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
    });
  }, [reduced]);

  return (
    // La sección va a ancho completo: si se limita a 1200px, el `pointermove`
    // deja de dispararse en los márgenes y el gradiente se corta en seco ahí.
    <section id="top" ref={sectionRef} className="relative">
      {/* Halo que sigue al cursor. Sin puntero fino se queda en su posición de reposo. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(640px circle at var(--mx, 68%) var(--my, 42%), rgba(26,158,92,0.13), transparent 62%)",
        }}
      />

      <div className="relative mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-14 px-6 pb-[96px] pt-16 pin:grid-cols-[55fr_45fr] pin:px-10">
        <div>
          <div {...eyebrow} className="eyebrow">
            Tutelas y derechos de petición · Colombia
          </div>

          <h1
            {...title}
            className="mt-[18px] text-pretty text-[clamp(38px,6.4vw,62px)] font-semibold leading-[1.04] tracking-[-0.03em] text-ink"
          >
            Cuéntale lo que te negó tu EPS. Te devuelve tu tutela lista para radicar.
          </h1>

          <p {...lead} className="mt-6 max-w-[520px] text-pretty text-[19px] text-muted">
            Una tutela, o un derecho de petición si ese es el paso correcto. Por WhatsApp o
            por llamada, escribiendo o hablando. Sin abogado, sin costo, sin salir de casa.
          </p>

          <div {...actions} className="mt-8 flex flex-wrap gap-3">
            <WhatsAppCta />
            {/* El canal telefónico no es un extra: tiene que verse sin hacer scroll. */}
            <GhostLink href="#telefono">O que Mijo te llame</GhostLink>
          </div>

          <p
            {...legal}
            className="mt-[30px] max-w-[460px] border-t border-line pt-5 font-mono text-[11.5px] leading-[1.6] text-faint"
          >
            Decreto 2591 de 1991, art. 10 — «no será necesario actuar por medio de
            apoderado»
          </p>
        </div>

        <div ref={phoneRef} className="relative flex justify-center">
          <div
            aria-hidden
            className="pointer-events-none absolute top-[90px] h-[300px] w-[300px] rounded-full bg-brand-bright/20 blur-[80px]"
          />
          <PhoneChat />
        </div>
      </div>
    </section>
  );
}

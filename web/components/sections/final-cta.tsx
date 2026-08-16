"use client";

import { useRef } from "react";
import { useReveal } from "@/components/ui/reveal";
import { WhatsAppCta } from "@/components/ui/whatsapp-cta";
import { usePointerGlow } from "@/hooks/use-pointer-glow";

export function FinalCta() {
  const sectionRef = useRef<HTMLElement>(null);
  usePointerGlow(sectionRef);

  const title = useReveal<HTMLHeadingElement>();
  const cta = useReveal<HTMLDivElement>(80);

  return (
    <section ref={sectionRef} className="relative overflow-hidden bg-brand py-[104px]">
      {/* Sobre el verde plano, el cursor se lee como una fuente de luz. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(680px circle at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,0.11), transparent 58%)",
        }}
      />

      <div className="relative mx-auto max-w-[1200px] px-6 pin:px-10">
        <h2
          {...title}
          className="max-w-[900px] text-pretty text-[clamp(34px,5.4vw,52px)] font-semibold leading-[1.1] tracking-[-0.03em] text-white"
        >
          La tutela ya era gratis y ya no necesitaba abogado. Ahora tampoco necesita que
          sepas cómo se hace, ni que tengas internet.
        </h2>

        <div {...cta} className="mt-10">
          <WhatsAppCta variant="light" size="lg" />
        </div>
      </div>
    </section>
  );
}

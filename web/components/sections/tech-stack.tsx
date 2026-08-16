"use client";

import { useReveal } from "@/components/ui/reveal";

const STACK = [
  "WhatsApp (Twilio)",
  "Llamadas de voz (Twilio)",
  "Marcación por tonos (DTMF)",
  "Gemini 2.5 Flash",
  "gemini-embedding-001",
  "ElevenLabs Scribe",
  "ElevenLabs TTS con acentos colombianos",
  "Resend",
  "Next.js",
  "Chromium headless",
];

export function TechStack() {
  const note = useReveal<HTMLParagraphElement>();

  return (
    <section id="tecnologia" className="mx-auto max-w-[1200px] px-6 py-[88px] pin:px-10">
      <ul className="flex flex-wrap gap-x-[26px] gap-y-2.5 font-mono text-[13px] text-faint">
        {STACK.map((item) => (
          <li key={item} className="transition-colors duration-150 hover:text-ink">
            {item}
          </li>
        ))}
      </ul>

      <p
        {...note}
        className="mt-7 max-w-[760px] text-pretty border-t border-line pt-6 text-base text-muted"
      >
        Mismo motor, otra materia: se agregó derecho de petición sin tocar la arquitectura.
        Educación, pensiones y servicios públicos son un corpus nuevo, no un producto nuevo.
      </p>
    </section>
  );
}

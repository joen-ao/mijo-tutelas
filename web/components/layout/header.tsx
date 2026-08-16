"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { onScrollFrame } from "@/lib/scroll";
import { WhatsAppCta } from "@/components/ui/whatsapp-cta";

const LINKS = [
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#telefono", label: "Por teléfono" },
  { href: "#verificador", label: "El verificador" },
  { href: "#resultados", label: "Resultados" },
  { href: "#tecnologia", label: "Tecnología" },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(
    () =>
      onScrollFrame(() => {
        const next = window.scrollY > 80;
        setScrolled((prev) => (prev === next ? prev : next));
      }),
    [],
  );

  return (
    <header
      className="sticky top-0 z-60 border-b transition-[background-color,border-color] duration-200"
      style={{
        backgroundColor: scrolled ? "rgba(245,246,244,0.82)" : "transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(12px)" : "none",
        borderBottomColor: scrolled ? "var(--color-line)" : "transparent",
      }}
    >
      <div className="mx-auto flex h-[68px] max-w-[1200px] items-center justify-between gap-6 px-6 pin:px-10">
        <a
          href="#top"
          className="flex items-center gap-2.5 text-[21px] font-bold tracking-[-0.02em] text-brand-deep"
        >
          <Image
            src="/static/logo-mijo.png"
            alt=""
            width={512}
            height={512}
            priority
            className="h-8 w-8 rounded-full"
          />
          Mijo
        </a>

        {/* Cinco enlaces caben justo a 1000px; el gap se abre en pantallas mayores. */}
        <nav className="hidden gap-[18px] text-[14.5px] text-muted pin:flex xl:gap-[26px]">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} className="text-muted hover:text-brand-deep">
              {link.label}
            </a>
          ))}
        </nav>

        <WhatsAppCta size="sm">
          <span className="hidden sm:inline">Escríbele por WhatsApp</span>
          <span className="sm:hidden">WhatsApp</span>
        </WhatsAppCta>
      </div>
    </header>
  );
}

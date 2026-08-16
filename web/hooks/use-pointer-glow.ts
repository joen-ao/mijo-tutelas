"use client";

import { useEffect, type RefObject } from "react";
import { useReducedMotion } from "@/hooks/use-media-query";

/**
 * Publica la posición del cursor dentro del elemento como `--mx` / `--my`,
 * para que el fondo pueda reaccionar sin re-renderizar React.
 *
 * Solo con puntero fino: en táctil no hay cursor que seguir y el gradiente
 * se quedaría clavado donde ocurrió el último toque.
 */
export function usePointerGlow(ref: RefObject<HTMLElement | null>) {
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    let frame = 0;
    let x = 0;
    let y = 0;

    const paint = () => {
      frame = 0;
      el.style.setProperty("--mx", `${x}px`);
      el.style.setProperty("--my", `${y}px`);
    };

    const onMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      x = event.clientX - rect.left;
      y = event.clientY - rect.top;
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const onLeave = () => {
      el.style.removeProperty("--mx");
      el.style.removeProperty("--my");
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [ref, reduced]);
}

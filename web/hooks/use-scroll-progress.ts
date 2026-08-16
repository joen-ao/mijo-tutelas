"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { onScrollFrame, sectionProgress } from "@/lib/scroll";

/**
 * Progreso de la sección como estado de React, cuantizado para no re-renderizar
 * en cada frame. Úsalo cuando el progreso decide qué se muestra.
 */
export function useScrollProgress(
  ref: RefObject<HTMLElement | null>,
  pinned: boolean,
  steps = 200,
) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return onScrollFrame(() => {
      const next = Math.round(sectionProgress(el, pinned) * steps) / steps;
      setProgress((prev) => (prev === next ? prev : next));
    });
  }, [ref, pinned, steps]);

  return progress;
}

/**
 * Progreso continuo entregado por callback, sin re-render. Úsalo para mover
 * cosas (parallax, desplazamiento horizontal, canvas).
 */
export function useScrollProgressEffect(
  ref: RefObject<HTMLElement | null>,
  pinned: boolean,
  apply: (progress: number) => void,
) {
  const applyRef = useRef(apply);

  useEffect(() => {
    applyRef.current = apply;
  }, [apply]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return onScrollFrame(() => applyRef.current(sectionProgress(el, pinned)));
  }, [ref, pinned]);
}

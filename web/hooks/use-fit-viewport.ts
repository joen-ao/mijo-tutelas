"use client";

import { useEffect, type RefObject } from "react";

/**
 * En las secciones ancladas el contenido no puede pasarse de alto: si lo hace,
 * se escala hacia abajo en lugar de recortarse.
 */
export function useFitViewport(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      el.style.transform = "none";
      if (!active) return;
      const scale = Math.min(1, (window.innerHeight - 40) / Math.max(1, el.scrollHeight));
      if (scale < 0.995) el.style.transform = `scale(${scale.toFixed(3)})`;
    };

    fit();
    // Las fuentes web cambian la altura al cargar.
    document.fonts?.ready.then(fit).catch(() => {});
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      el.style.transform = "none";
    };
  }, [ref, active]);
}

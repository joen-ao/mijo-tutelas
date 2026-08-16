"use client";

import { useEffect, useRef, useState } from "react";

type Options = {
  /** Margen del root; negativo abajo hace que dispare un poco antes del borde. */
  rootMargin?: string;
  threshold?: number;
  /** Si es false, vuelve a `false` al salir del viewport. */
  once?: boolean;
};

export function useInView<T extends HTMLElement>({
  rootMargin = "0px 0px -12% 0px",
  threshold = 0,
  once = true,
}: Options = {}) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin, threshold },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin, threshold, once]);

  return { ref, inView };
}

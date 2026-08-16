"use client";

import { useEffect, useState } from "react";
import { useInView } from "@/hooks/use-in-view";
import { useReducedMotion } from "@/hooks/use-media-query";
import { formatEsCo } from "@/lib/format";

type Props = {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
};

export function CountUp({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 600,
  className,
}: Props) {
  const final = `${prefix}${formatEsCo(value, decimals)}${suffix}`;
  // Arranca en cuanto el bloque toca el viewport: cuanto antes empiece y antes
  // termine, menos probable es que se lea un valor intermedio como si fuera el dato.
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: "0px" });
  const reduced = useReducedMotion();
  // El valor final ya viaja en el HTML: sin JS el dato se lee igual.
  const [text, setText] = useState(final);

  useEffect(() => {
    if (!inView || reduced) return;

    let frame = 0;
    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setText(
        t < 1 ? `${prefix}${formatEsCo(value * eased, decimals)}${suffix}` : final,
      );
      if (t < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [inView, reduced, value, decimals, prefix, suffix, duration, final]);

  return (
    <div ref={ref} className={className}>
      {text}
    </div>
  );
}

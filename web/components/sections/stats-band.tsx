import { CountUp } from "@/components/ui/count-up";

const STATS = [
  { value: 312500, label: <>tutelas por salud en 2025</> },
  { value: 34, suffix: "%", label: <>de todas las tutelas del país</> },
  { value: 74.3, decimals: 1, suffix: "%", label: <>de esas tutelas se conceden</> },
  {
    value: 90,
    prefix: "~",
    suffix: "%",
    accent: true,
    label: (
      <>
        reclamaban algo <strong className="font-semibold text-ink">ya incluido</strong> en el
        plan
      </>
    ),
  },
];

export function StatsBand() {
  return (
    // El header pegajoso mide 68px: sin holgura arriba, cortaba las cifras al pasar.
    <section className="scroll-mt-[84px] border-y border-line bg-surface">
      <div className="mx-auto max-w-[1200px] px-6 pb-12 pt-[72px] pin:px-10">
        <div className="grid grid-cols-2 items-start gap-x-6 gap-y-10 pin:grid-cols-4 pin:gap-y-0">
          {STATS.map((stat, i) => (
            <div
              key={i}
              className="pin:border-l pin:border-line pin:pl-6 pin:first:border-l-0 pin:first:pl-0 pin:[&:not(:first-child)]:pr-6"
            >
              <CountUp
                value={stat.value}
                decimals={stat.decimals}
                prefix={stat.prefix}
                suffix={stat.suffix}
                className={`tabular-nums text-[clamp(32px,4.4vw,44px)] font-semibold leading-none tracking-[-0.03em] ${
                  stat.accent ? "text-brand" : "text-brand-deep"
                }`}
              />
              <p className="mt-2 text-sm text-muted">{stat.label}</p>
            </div>
          ))}
        </div>

        <p className="mt-[22px] font-mono text-[11px] text-faint">
          Defensoría del Pueblo, informe del 23 de abril de 2026.
        </p>
      </div>
    </section>
  );
}

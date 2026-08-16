"use client";

import { useReveal } from "@/components/ui/reveal";

export function Authorization() {
  const consent = useReveal<HTMLDivElement>();
  const demo = useReveal<HTMLDivElement>(80);

  return (
    <section className="mx-auto grid max-w-[1200px] grid-cols-1 items-start gap-12 px-6 py-[96px] pin:grid-cols-[52fr_48fr] pin:px-10">
      <div
        {...consent}
        className="border border-l-[3px] border-line border-l-brand bg-surface p-7"
      >
        <p className="text-pretty font-serif text-[22px] leading-[1.4] text-ink">
          «¿Quieres que la radique por ti ante la Oficina Judicial de Reparto de Medellín?»
        </p>
        <p className="mt-3.5 text-pretty text-[15px] text-muted">
          Solo con un sí explícito se envía. Radicar abre un proceso y fija términos: eso se
          autoriza, no se asume.
        </p>
      </div>

      <p
        {...demo}
        className="text-pretty border border-dashed border-[#c9cfc8] p-6 text-sm leading-[1.6] text-muted"
      >
        En la demo el correo va a un buzón de pruebas. El motivo no es técnico: una tutela de
        prueba en una Oficina de Reparto ocupa el turno de alguien enfermo que espera un
        tratamiento. Un producto que existe para destrabar el acceso a la justicia no puede
        empezar congestionándola. El único cambio para producción es quitar una variable de
        entorno.
      </p>
    </section>
  );
}

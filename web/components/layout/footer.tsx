import Image from "next/image";

export function Footer() {
  return (
    <footer className="border-t border-line bg-canvas">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-8 px-6 py-[34px] pin:px-10">
        <div className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.02em] text-brand-deep">
          <Image
            src="/static/logo-mijo.png"
            alt=""
            width={512}
            height={512}
            className="h-7 w-7 rounded-full"
          />
          Mijo
        </div>
        <p className="max-w-[720px] text-pretty text-xs leading-[1.6] text-faint">
          Mijo no presta servicios de abogacía: prepara un borrador que la persona revisa,
          firma y radica por sí misma, como la ley expresamente le permite (Decreto 2591 de
          1991, art. 10).
        </p>
      </div>
    </footer>
  );
}

import { cn } from "@/lib/utils";
import { phoneLink, whatsappLink } from "@/lib/config";

type Variant = "solid" | "outline" | "light";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center rounded-[4px] font-semibold transition-[transform,background-color,border-color] duration-150 will-change-transform";

const variants: Record<Variant, string> = {
  solid: "bg-brand text-white hover:bg-brand-deep hover:-translate-y-0.5",
  outline:
    "border border-[#cfd6cf] bg-transparent font-medium text-ink hover:border-brand hover:-translate-y-0.5",
  light: "bg-white text-brand-deep hover:-translate-y-0.5",
};

const sizes: Record<Size, string> = {
  sm: "h-10 px-[18px] text-[14.5px]",
  md: "h-[50px] px-6 text-base",
  lg: "h-[54px] px-[26px] text-[16.5px]",
};

export function WhatsAppCta({
  children = "Escríbele por WhatsApp",
  variant = "solid",
  size = "md",
  className,
}: {
  children?: React.ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
}) {
  return (
    <a
      href={whatsappLink()}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(base, variants[variant], sizes[size], className)}
    >
      {children}
    </a>
  );
}

export function PhoneCta({
  children = "Llama a Mijo",
  variant = "outline",
  size = "md",
  className,
}: {
  children?: React.ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
}) {
  return (
    <a href={phoneLink()} className={cn(base, variants[variant], sizes[size], className)}>
      {children}
    </a>
  );
}

export function GhostLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a href={href} className={cn(base, variants.outline, sizes.md, className)}>
      {children}
    </a>
  );
}

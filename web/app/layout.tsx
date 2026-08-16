import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "Mijo · tu tutela de salud por WhatsApp",
  description:
    "Convierte el relato de una persona en una acción de tutela lista para radicar, "
    + "con jurisprudencia de la Corte Constitucional verificada.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${figtree.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}

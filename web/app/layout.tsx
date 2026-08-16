import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mijo — tu tutela por WhatsApp o por teléfono",
  description:
    "Cuéntale lo que te negó tu EPS y Mijo te devuelve tu tutela lista para radicar. "
    + "Por WhatsApp o por llamada, hablando: sin abogado, sin costo y sin necesidad de internet.",
  icons: { icon: "/static/logo-mijo.png", apple: "/static/logo-mijo.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={figtree.variable}>
      <head>
        {/* Sin JS, los bloques con revelado por scroll quedarían invisibles. */}
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important}`}</style>
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { COLOR_FONDO } from "./tema";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Plata", template: "%s | Plata" },
  description: "Tu plata, clara: cuánto puedes gastar hoy y por qué.",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: 'Plata', statusBarStyle: 'black' },
};

export const viewport: Viewport = {
  themeColor: COLOR_FONDO,
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

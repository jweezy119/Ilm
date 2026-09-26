import type { Metadata } from "next";
import {
  Noto_Naskh_Arabic,
  Plus_Jakarta_Sans,
  Space_Mono,
} from "next/font/google";

import { starterConfig } from "../../starter.config";
import StarterShell from "@/components/starter-shell";
import "./globals.css";

const bodyFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  weight: ["400", "500", "600", "700", "800"],
});

const arabicFont = Noto_Naskh_Arabic({
  subsets: ["arabic"],
  variable: "--font-noto-arabic",
  weight: ["400", "500", "600", "700"],
});

const monoFont = Space_Mono({
  subsets: ["latin"],
  variable: "--font-space-mono",
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  description: starterConfig.app.description,
  title: starterConfig.app.name,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${bodyFont.variable} ${arabicFont.variable} ${monoFont.variable}`}
      >
        <StarterShell />
        {children}
      </body>
    </html>
  );
}

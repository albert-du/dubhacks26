import type { Metadata, Viewport } from "next";
import { Archivo_Black, IBM_Plex_Mono } from "next/font/google";
import { SWRegister } from "@/components/SWRegister";
import "./globals.css";

const display = Archivo_Black({ weight: "400", subsets: ["latin"], variable: "--font-archivo-black", display: "swap" });
const mono = IBM_Plex_Mono({ weight: ["400", "500", "700"], subsets: ["latin"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Dump — throw every photo in", template: "%s — Dump" },
  description: "Zero-login, self-destructing photo & video pools for group events. Scan, drop, find yourself. Gone in 72h.",
  applicationName: "Dump",
  appleWebApp: { capable: true, title: "Dump", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
};

export const viewport: Viewport = {
  themeColor: "#f1eee4",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="min-h-dvh antialiased">
        {children}
        <SWRegister />
      </body>
    </html>
  );
}

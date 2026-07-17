import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { Providers } from "./providers";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
});

export const metadata: Metadata = {
  title: "Waly Motors OS",
  description: "Gestión de alquiler y venta de mototaxis — Waldir Yarlequé",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Waly Motors",
  },
};

export const viewport: Viewport = {
  themeColor: "#F9F9F7",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-PE">
      <body className={`${archivo.variable} bg-fondo font-sans text-grafito antialiased`}>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}

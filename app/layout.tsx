import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { PwaRegister } from "@/components/shell/pwa-register";
import { EnvBanner } from "@/components/shell/env-banner";

export const metadata: Metadata = {
  title: "Equiwings Central Admin Panel",
  description: "Multi-centre equestrian management — riders, horses, attendance, finance.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Equiwings",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-192.svg",
    apple: "/icons/icon-192.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <EnvBanner />
        {children}
        <Toaster richColors position="top-right" />
        <PwaRegister />
      </body>
    </html>
  );
}

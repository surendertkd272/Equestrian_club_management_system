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
  // Modern PWA spec — Chrome/Edge/Firefox honour `mobile-web-app-capable`;
  // Safari still reads the apple-prefixed one (emitted via `appleWebApp`).
  // Setting both silences the deprecation warning in DevTools.
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before paint so there's no light→dark flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.theme==='dark')document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        <EnvBanner />
        {children}
        <Toaster richColors position="top-right" />
        <PwaRegister />
      </body>
    </html>
  );
}

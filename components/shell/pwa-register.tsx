"use client";

import { useEffect } from "react";

// Registers the service worker on first client render. No-op in dev unless
// we explicitly opt in (registering in dev causes hot-reload weirdness).
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production" && !process.env.NEXT_PUBLIC_SW_DEV) return;

    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}

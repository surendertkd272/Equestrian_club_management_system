"use client";

import { useEffect } from "react";

// Fire the browser print dialog once the packet (and its images) have settled.
export function AutoPrint() {
  useEffect(() => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      window.print();
    };
    // Give images a beat to load so they're in the print output; window.load
    // covers the common case, the timeout is a fallback if it already fired.
    if (document.readyState === "complete") {
      const t = setTimeout(go, 400);
      return () => clearTimeout(t);
    }
    window.addEventListener("load", () => setTimeout(go, 400), { once: true });
    const t = setTimeout(go, 2500);
    return () => clearTimeout(t);
  }, []);
  return null;
}

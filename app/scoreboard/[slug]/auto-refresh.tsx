"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Replaces the old <meta http-equiv="refresh">. Uses router.refresh() so the
// page re-runs the server component without a full page reload — keeps the
// user's scroll position and any focused element. Falls back gracefully if
// the EventSource isn't available (we'd add SSE here if we needed sub-10s
// updates; polling is fine for placements that update every few minutes).
export function LiveAutoRefresh({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    function tick() {
      if (document.hidden) return;
      router.refresh();
    }
    id = setInterval(tick, intervalMs);
    return () => {
      if (id) clearInterval(id);
    };
  }, [router, intervalMs]);
  return null;
}

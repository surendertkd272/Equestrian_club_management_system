"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { buildTourSteps } from "@/lib/onboarding/tour";

// Mounted once in the admin shell. Fires the first-run guided tour on the
// Dashboard (when the user has never completed it) and on demand via `?tour=1`
// — both the Help Center link (/dashboard?tour=1, a cross-layout navigation)
// and the in-dashboard checklist tile (a query-only navigation). Because this
// host lives in the persistent (admin) layout, the query-only case is handled
// reactively via useSearchParams rather than a remount. Everything is wrapped
// so a failure is silent — the tour must never break a page.
export function TourHost({
  roleTitle,
  userName,
  topLabels,
  autoStart,
}: {
  roleTitle: string;
  userName: string | null;
  topLabels: string[];
  autoStart: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const firstRunFired = useRef(false);
  const firing = useRef(false);

  const onDashboard = pathname === "/dashboard";
  const replay = searchParams.get("tour") === "1";

  useEffect(() => {
    try {
      // Replay is gated to the dashboard too, so a stray ?tour=1 on another
      // page can't pop the tour out of context.
      const shouldReplay = replay && onDashboard;
      const shouldAuto = autoStart && onDashboard && !firstRunFired.current;
      if (!shouldReplay && !shouldAuto) return;
      if (firing.current) return;
      firing.current = true;
      if (shouldAuto) firstRunFired.current = true;

      const isMobile = window.innerWidth < 768;
      const steps = buildTourSteps({ roleTitle, userName, topLabels, isMobile })
        .filter((s) => !s.target || document.querySelector(s.target))
        .map((s) => ({ ...(s.target ? { element: s.target } : {}), popover: { title: s.title, description: s.body } }));
      if (steps.length === 0) {
        firing.current = false;
        return;
      }

      const markDone = () => {
        fetch("/api/me/onboarding", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tourCompleted: true }),
        }).catch(() => {});
        firing.current = false;
        // Strip ?tour=1 so it doesn't linger / re-fire on the next render.
        if (replay) {
          const params = new URLSearchParams(Array.from(searchParams.entries()));
          params.delete("tour");
          const qs = params.toString();
          router.replace(qs ? `${pathname}?${qs}` : pathname);
        }
      };

      const d = driver({
        showProgress: true,
        allowClose: true,
        overlayOpacity: 0.6,
        popoverClass: "ew-tour", // themed in globals.css to match the app
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Got it",
        steps,
        onDestroyed: markDone,
      });
      d.drive();
    } catch {
      firing.current = false;
    }
  }, [replay, onDashboard, autoStart, roleTitle, userName, topLabels, pathname, searchParams, router]);

  return null;
}

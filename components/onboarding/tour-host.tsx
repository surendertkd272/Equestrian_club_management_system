"use client";

import { useEffect, useRef } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { buildTourSteps } from "@/lib/onboarding/tour";

// Mounted once in the admin shell. Fires the first-run guided tour on the
// Dashboard (when the user has never completed it) and on demand via a
// `?tour=1` query param (the Help Center's "replay" link lands on
// /dashboard?tour=1, which remounts this host). Everything is wrapped so a
// failure is silent — the tour must never break a page.
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
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const isReplay = params.get("tour") === "1";
      const onDashboard = window.location.pathname === "/dashboard";
      if (!isReplay && !(autoStart && onDashboard)) return;
      ran.current = true;

      const isMobile = window.innerWidth < 768;
      const steps = buildTourSteps({ roleTitle, userName, topLabels, isMobile })
        // Drop spotlight steps whose target isn't on the page; keep centered steps.
        .filter((s) => !s.target || document.querySelector(s.target))
        .map((s) => ({
          ...(s.target ? { element: s.target } : {}),
          popover: { title: s.title, description: s.body },
        }));
      if (steps.length === 0) return;

      const markDone = () => {
        fetch("/api/me/onboarding", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tourCompleted: true }),
        }).catch(() => {});
        if (isReplay) {
          const url = new URL(window.location.href);
          url.searchParams.delete("tour");
          window.history.replaceState({}, "", url.toString());
        }
      };

      const d = driver({
        showProgress: true,
        allowClose: true,
        overlayOpacity: 0.6,
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Got it",
        steps,
        onDestroyed: markDone,
      });
      d.drive();
    } catch {
      // Never let the tour break the app.
    }
  }, [roleTitle, userName, topLabels, autoStart]);

  return null;
}

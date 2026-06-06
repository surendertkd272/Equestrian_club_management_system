"use client";

import { useEffect, useState } from "react";

type Row = {
  id: string;
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaHref: string | null;
  severity: "info" | "success" | "warning" | "maintenance";
};

const TONE: Record<Row["severity"], string> = {
  info: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100",
  success: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  maintenance: "border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100",
};

// In-app announcements banner. Fetches active announcements for the
// signed-in user, renders the most recent ≤3 at the top of the
// dashboard. "Got it" → records a dismissal so the same item won't
// reappear.
export function AnnouncementsBanner() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/announcements")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data) => setRows(Array.isArray(data.rows) ? data.rows.slice(0, 3) : []))
      .catch(() => setRows([]))
      .finally(() => setLoaded(true));
  }, []);

  async function dismiss(id: string) {
    setRows((r) => r.filter((x) => x.id !== id));
    void fetch("/api/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  if (!loaded || rows.length === 0) return null;

  return (
    <div className="space-y-2">
      {rows.map((a) => (
        <div
          key={a.id}
          className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${TONE[a.severity]}`}
        >
          <div className="flex-1">
            <div className="font-semibold">{a.title}</div>
            <div className="mt-1 text-xs leading-relaxed">{a.body}</div>
            {a.ctaHref && a.ctaLabel && (
              <a
                href={a.ctaHref}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block rounded-md bg-foreground/10 px-2.5 py-1 text-xs font-medium hover:bg-foreground/20"
              >
                {a.ctaLabel} →
              </a>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismiss(a.id)}
            className="rounded px-2 py-0.5 text-xs font-medium hover:bg-foreground/10"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

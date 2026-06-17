"use client";

// Global Cmd/Ctrl + K search palette. Mounted once in the admin layout.
// Opens with the keyboard shortcut, "/" key when not in an input, or via the
// TopBar trigger. Debounced 150ms fetch against /api/search; hits navigate
// straight to the canonical detail page.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Users,
  Rabbit,
  UserCog,
  Building2,
  Award,
  ClipboardList,
  CalendarClock,
  Pill,
} from "lucide-react";

type Hit = {
  kind:
    | "rider"
    | "horse"
    | "user"
    | "centre"
    | "certificate"
    | "exam"
    | "batch"
    | "medicine";
  id: string;
  href: string;
  primary: string;
  secondary?: string;
};

const ICONS: Record<Hit["kind"], React.ComponentType<{ className?: string }>> = {
  rider: Users,
  horse: Rabbit,
  user: UserCog,
  centre: Building2,
  certificate: Award,
  exam: ClipboardList,
  batch: CalendarClock,
  medicine: Pill,
};

const LABELS: Record<Hit["kind"], string> = {
  rider: "Rider",
  horse: "Horse",
  user: "User",
  centre: "Centre",
  certificate: "Certificate",
  exam: "Exam",
  batch: "Batch",
  medicine: "Medicine",
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global keyboard shortcut: Cmd/Ctrl+K. Also "/" outside of inputs.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          (target as any).isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "/" && !inField && !open) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Re-focus input + reset state when reopening.
  useEffect(() => {
    if (open) {
      setQ("");
      setHits([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounced fetch. 150ms feels snappy without hammering the API on each keystroke.
  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setHits(Array.isArray(data.hits) ? data.hits : []);
          setActive(0);
        }
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => clearTimeout(handle);
  }, [q, open]);

  function go(hit: Hit) {
    setOpen(false);
    router.push(hit.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(hits.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      const hit = hits[active];
      if (hit) {
        e.preventDefault();
        go(hit);
      }
    }
  }

  if (!open) {
    // Trigger affordance. On phones the sidebar is a drawer, so search is the
    // fastest way to a named rider/horse — give it a visible icon button there;
    // desktop keeps the full bar with the keyboard-shortcut hint.
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Search"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border bg-card text-muted-foreground hover:bg-muted md:hidden"
        >
          <Search className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="hidden h-9 items-center gap-2 rounded-md border bg-card px-3 text-xs text-muted-foreground hover:bg-muted md:inline-flex"
          title="Search — Cmd/Ctrl + K"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search…</span>
          <kbd className="ml-2 rounded border bg-background px-1.5 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>
      </>
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label="Search"
        className="fixed left-1/2 top-[18%] z-50 w-full max-w-xl -translate-x-1/2 rounded-lg border bg-card shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search riders, horses, exams, batches, meds…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            Esc
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-1">
          {loading && q.length >= 2 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
          )}
          {!loading && q.length < 2 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              Type at least 2 characters. Press ↑ ↓ to navigate, Enter to open.
            </div>
          )}
          {!loading && q.length >= 2 && hits.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">No matches.</div>
          )}
          {hits.map((h, i) => {
            const Icon = ICONS[h.kind];
            return (
              <button
                key={`${h.kind}-${h.id}`}
                type="button"
                onClick={() => go(h)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${
                  i === active ? "bg-muted" : "hover:bg-muted/60"
                }`}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{h.primary}</div>
                  {h.secondary && (
                    <div className="truncate text-xs text-muted-foreground">{h.secondary}</div>
                  )}
                </div>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {LABELS[h.kind]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
          <span className="font-mono">↑↓</span> navigate ·{" "}
          <span className="font-mono">Enter</span> open ·{" "}
          <span className="font-mono">Esc</span> close
        </div>
      </div>
    </>
  );
}

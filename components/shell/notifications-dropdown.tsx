"use client";

// Bell-icon trigger that opens a slide-out panel listing unread notifications
// without navigating away. "Mark all read" + per-row "Mark read" supported.
// Mounted in the admin TopBar; clicking the underlying bell icon now opens
// the panel instead of pushing to /notifications.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Check, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { timeAgo } from "@/lib/i18n";

type Item = {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export function NotificationsDropdown({ initialUnread }: { initialUnread: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [unread, setUnread] = useState(initialUnread);

  // Lazy-load the list — only fetch when the user actually opens it.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setLoadError(false);
    fetch("/api/notifications?unreadOnly=1&limit=20")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setItems(Array.isArray(d.rows) ? d.rows : []))
      .catch(() => setLoadError(true)) // don't fall through to a false "all caught up"
      .finally(() => setLoading(false));
  }, [open, reloadKey]);

  // Poll the unread count.
  //
  // This was a Server-Sent Events stream, and that is what paused the Vercel
  // project twice. SSE holds a serverless function open for as long as a staff
  // member has the app open — the function is billed for that whole time, so
  // one person with one tab cost about 1.7 GB-hours per hour, and a single
  // working week of one user exhausted the plan's entire monthly function
  // budget. A backgrounded tab kept paying, too, because the stream had no
  // visibility check.
  //
  // A 60s poll of one indexed COUNT costs on the order of a thousandth of that
  // and the bell is no less useful: an unread badge does not need to be live to
  // the second. Do not reintroduce a long-lived connection here without moving
  // the app off per-second function billing first.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/notifications/unread-count");
        if (!res.ok) return;
        const d = await res.json();
        if (!cancelled && typeof d.count === "number") setUnread(d.count);
      } catch {}
    }
    const id = setInterval(refresh, 60_000);
    // A hidden tab skips its polls, so catch up the moment it comes back
    // rather than showing a stale badge for up to a minute.
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  async function markOne(id: string) {
    // Only drop the row + decrement the badge if the write actually succeeded —
    // otherwise a failed/dropped request left the badge count wrong.
    try {
      const res = await fetch(`/api/notifications/${id}/read`, { method: "POST" });
      if (!res.ok) return;
    } catch {
      return;
    }
    setItems((s) => s.filter((x) => x.id !== id));
    setUnread((n) => Math.max(0, n - 1));
  }

  async function markAll() {
    const res = await fetch("/api/notifications/read-all", { method: "POST" });
    if (!res.ok) {
      toast.error("Couldn't mark all read");
      return;
    }
    setItems([]);
    setUnread(0);
    toast.success("All caught up");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border bg-card hover:bg-muted"
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
        title={unread > 0 ? `${unread} unread` : "No new notifications"}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid min-h-[18px] min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div role="dialog" aria-label="Notifications" className="absolute right-4 top-14 z-40 w-96 max-w-[calc(100vw-2rem)] rounded-lg border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div className="text-sm font-semibold">Notifications</div>
              <div className="flex items-center gap-2">
                {unread > 0 && (
                  <button
                    onClick={markAll}
                    className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] hover:bg-muted"
                    title="Mark all read"
                  >
                    <CheckCheck className="h-3 w-3" /> Mark All Read
                  </button>
                )}
                <Link
                  href="/notifications?filter=unread"
                  className="text-[11px] text-muted-foreground hover:underline"
                  onClick={() => setOpen(false)}
                  title="See every unread item"
                >
                  View All →
                </Link>
              </div>
            </div>

            <div role="list" className="max-h-[70vh] overflow-y-auto">
              {loading && (
                <div className="px-3 py-4 text-xs text-muted-foreground">Loading…</div>
              )}
              {/* Fetch failed — never let an empty list read as "all caught up". */}
              {!loading && loadError && (
                <div className="px-3 py-6 text-center text-sm">
                  <p className="text-muted-foreground">Couldn't load notifications.</p>
                  <button
                    onClick={() => setReloadKey((k) => k + 1)}
                    className="mt-2 rounded border px-2 py-1 text-xs hover:bg-muted"
                  >
                    Retry
                  </button>
                </div>
              )}
              {/* Genuinely empty: list returned nothing AND the live counter agrees. */}
              {!loading && !loadError && items.length === 0 && unread === 0 && (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  All caught up 🎉
                </div>
              )}
              {/* Counter says unread but the list came back empty (e.g. >20, or a
                  read elsewhere raced the fetch) — point to the full list. */}
              {!loading && !loadError && items.length === 0 && unread > 0 && (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {unread} unread notification{unread === 1 ? "" : "s"}.{" "}
                  <Link href="/notifications?filter=unread" onClick={() => setOpen(false)} className="text-primary hover:underline">
                    View All →
                  </Link>
                </div>
              )}
              {items.map((n) => (
                <div key={n.id} role="listitem" className="border-t px-3 py-2 hover:bg-muted/40">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{n.title}</div>
                      <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>
                      <div className="mt-1 text-[10px] text-muted-foreground">{timeAgo(n.createdAt)}</div>
                    </div>
                    <button
                      onClick={() => markOne(n.id)}
                      className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Mark read" aria-label="Mark read"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  </div>
                  {n.link && (
                    <Link
                      href={n.link}
                      onClick={() => setOpen(false)}
                      className="mt-1 inline-block text-[11px] text-primary hover:underline"
                    >
                      Open →
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

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
  const [unread, setUnread] = useState(initialUnread);

  // Lazy-load the list — only fetch when the user actually opens it.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/notifications?unreadOnly=1&limit=20")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.rows)) setItems(d.rows);
      })
      .finally(() => setLoading(false));
  }, [open]);

  // Subscribe to SSE for live unread counts; fall back to 60s polling if the
  // EventSource API isn't available or the connection drops.
  useEffect(() => {
    if (typeof window === "undefined" || !("EventSource" in window)) {
      const id = setInterval(async () => {
        if (document.hidden) return;
        try {
          const res = await fetch("/api/notifications/unread-count");
          const d = await res.json();
          if (typeof d.count === "number") setUnread(d.count);
        } catch {}
      }, 60_000);
      return () => clearInterval(id);
    }
    const es = new EventSource("/api/notifications/stream");
    es.addEventListener("unread", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        if (typeof data.count === "number") setUnread(data.count);
      } catch {}
    });
    return () => es.close();
  }, []);

  async function markOne(id: string) {
    await fetch(`/api/notifications/${id}/read`, { method: "POST" });
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
          <div className="absolute right-4 top-14 z-40 w-96 max-w-[calc(100vw-2rem)] rounded-lg border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div className="text-sm font-semibold">Notifications</div>
              <div className="flex items-center gap-2">
                {unread > 0 && (
                  <button
                    onClick={markAll}
                    className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] hover:bg-muted"
                    title="Mark all read"
                  >
                    <CheckCheck className="h-3 w-3" /> Mark all read
                  </button>
                )}
                <Link
                  href="/notifications?filter=unread"
                  className="text-[11px] text-muted-foreground hover:underline"
                  onClick={() => setOpen(false)}
                  title="See every unread item"
                >
                  View all →
                </Link>
              </div>
            </div>

            <div className="max-h-[70vh] overflow-y-auto">
              {loading && (
                <div className="px-3 py-4 text-xs text-muted-foreground">Loading…</div>
              )}
              {!loading && items.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  All caught up 🎉
                </div>
              )}
              {items.map((n) => (
                <div key={n.id} className="border-t px-3 py-2 hover:bg-muted/40">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{n.title}</div>
                      <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>
                      <div className="mt-1 text-[10px] text-muted-foreground">{timeAgo(n.createdAt)}</div>
                    </div>
                    <button
                      onClick={() => markOne(n.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Mark read" aria-label="Mark read"
                    >
                      <Check className="h-3 w-3" />
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

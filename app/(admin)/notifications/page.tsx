import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCheck } from "lucide-react";
import { MarkRead, MarkAllRead } from "./actions";
import { PLATFORM_TZ } from "@/lib/tz";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, { label: string; tone: "success" | "warning" | "destructive" | "outline" }> = {
  "rider.onboarded": { label: "rider", tone: "outline" },
  "exam.passed": { label: "exam · pass", tone: "success" },
  "exam.failed": { label: "exam · fail", tone: "destructive" },
  "medicine.withdrawal": { label: "vet · rest", tone: "warning" },
  "medicine.low_stock": { label: "low stock", tone: "destructive" },
  "task.assigned": { label: "task", tone: "outline" },
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: { filter?: string; limit?: string };
}) {
  const session = await requireSession();
  // ?filter=unread mirrors the topbar dropdown's slice so "View all" is a
  // continuation rather than a context switch.
  const unreadOnly = searchParams.filter === "unread";
  const where = { userId: session.userId, ...(unreadOnly ? { readAt: null } : {}) };
  // "Show older" raises the window rather than paging: notifications are read
  // top-down and losing your place mid-list is worse than a longer page.
  const PAGE = 100;
  const limit = Math.min(Math.max(Number(searchParams.limit) || PAGE, PAGE), 1000);
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.notification.count({ where }),
    // Counted in the DB, NOT from `items`. Deriving it from the fetched page
    // meant a user with more unread than the page size saw a capped number —
    // the badge said 100 when they had 109.
    prisma.notification.count({ where: { userId: session.userId, readAt: null } }),
  ]);
  const hasMore = total > items.length;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {hasMore ? `Showing ${items.length} of ${total}` : `${items.length} ${unreadOnly ? "unread" : "total"}`}
            {!unreadOnly && unread > 0 && (
              <> · <span className="font-semibold text-primary">{unread} unread</span></>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={unreadOnly ? "/notifications" : "/notifications?filter=unread"}
            className="rounded border bg-card px-2 py-1 text-xs hover:bg-muted"
          >
            {unreadOnly ? "Show All" : "Unread Only"}
          </Link>
          {unread > 0 && <MarkAllRead />}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inbox</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nothing here yet. Notifications appear automatically when riders sign up, exams complete, withdrawals are
              prescribed, or tasks are assigned to you.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const meta = TYPE_LABEL[n.type] ?? { label: n.type, tone: "outline" as const };
                const isUnread = !n.readAt;
                return (
                  <li key={n.id} className={`flex items-start gap-3 py-3 ${isUnread ? "" : "opacity-70"}`}>
                    <div className="mt-1 flex w-2 justify-center">
                      {isUnread ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <Badge variant={meta.tone}>{meta.label}</Badge>
                        <span className={`text-sm ${isUnread ? "font-semibold" : ""}`}>{n.title}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {n.createdAt.toLocaleString("en-IN", { timeZone: PLATFORM_TZ,
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                      {n.link && (
                        <Link href={n.link} className="mt-1 inline-block text-xs text-primary underline">
                          Open →
                        </Link>
                      )}
                    </div>
                    {isUnread && <MarkRead id={n.id} />}
                  </li>
                );
              })}
            </ul>
          )}

          {hasMore && (
            <div className="mt-4 border-t pt-3 text-center">
              <Link
                href={`/notifications?${new URLSearchParams({
                  ...(unreadOnly ? { filter: "unread" } : {}),
                  limit: String(limit + PAGE),
                }).toString()}`}
                className="text-xs text-primary underline"
              >
                Show older ({total - items.length} more)
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewAnnouncementForm } from "./form";

export const dynamic = "force-dynamic";

export default async function OwnerAnnouncementsPage() {
  const rows = await prisma.announcement.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { _count: { select: { dismissals: true } } },
  });

  const now = new Date();

  return (
    <div className="space-y-6 text-foreground">
      <div>
        <h1 className="text-2xl font-bold">Announcements</h1>
        <p className="text-sm text-muted-foreground">
          Show platform-wide messages on every tenant's dashboard. Users dismiss each card individually.
          Use sparingly — bombing tenants with banners is the fastest way to train them to ignore your messages.
        </p>
      </div>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Publish new</CardTitle>
        </CardHeader>
        <CardContent>
          <NewAnnouncementForm />
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Existing ({rows.length})</CardTitle>
          <CardDescription className="text-muted-foreground">Most recent first.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No announcements yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((a) => {
                const active = a.publishedAt && a.publishedAt <= now && (!a.expiresAt || a.expiresAt > now);
                return (
                  <li key={a.id} className="py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{a.title}</span>
                          <Badge variant="outline" className="text-[10px]">{a.severity}</Badge>
                          {active ? (
                            <Badge variant="default" className="text-[10px]">live</Badge>
                          ) : a.expiresAt && a.expiresAt < now ? (
                            <Badge variant="outline" className="text-[10px]">expired</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">scheduled</Badge>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{a.body}</div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {a.publishedAt
                            ? `Published ${a.publishedAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`
                            : "Unpublished"}
                          {a.expiresAt && ` · expires ${a.expiresAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`}
                          {a.planFilter && ` · plans: ${a.planFilter}`}
                          {a.roleFilter && ` · roles: ${a.roleFilter}`}
                          {" · "}
                          {a._count.dismissals} dismissals
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";
import { DispatchPanel } from "./dispatch-panel";

export const dynamic = "force-dynamic";

function thisMonthRange(): { from: string; to: string; label: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return {
    from: fmt(from),
    to: fmt(to),
    label: now.toLocaleString("en-IN", { month: "long", year: "numeric" }),
  };
}

export default async function ReportsPage() {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);

  const [riders, recentDispatches] = await Promise.all([
    prisma.rider.findMany({
      where: { ...centreWhere(centreId), status: "active" },
      select: { id: true, firstName: true, lastName: true, currentLevel: true, batch: { select: { name: true } } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    // The monthly sweep audits a notification per rider with
    // type="report.monthly_email". Listing the latest 30 lets centre
    // staff see at a glance which months have already been dispatched.
    prisma.notification.findMany({
      where: {
        type: "report.monthly_email",
        ...(centreId ? { centreId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, title: true, body: true, createdAt: true, centreId: true },
    }),
  ]);

  const month = thisMonthRange();
  const canDispatch = ["SUPER_ADMIN", "CENTRE_MANAGER"].includes(session.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Report cards</h1>
        <p className="text-sm text-muted-foreground">
          §4.5 · Monthly parent report cards. Pulls attendance, progress milestones, exam results, fees, and
          certificates for the selected period — print or save as PDF.
        </p>
      </div>

      {canDispatch && (
        <Card>
          <CardHeader>
            <CardTitle>Monthly dispatch</CardTitle>
            <CardDescription>
              The auto-sweep runs on the 1st of every month and emails the previous month's report card
              to every linked parent. Press the button below to fire it manually — already-sent
              riders are skipped (20-day dedup window).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DispatchPanel />
          </CardContent>
        </Card>
      )}

      {recentDispatches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent dispatches</CardTitle>
            <CardDescription>Latest monthly report-card emails recorded on this centre.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {recentDispatches.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{d.title}</div>
                    <div className="text-xs text-muted-foreground">{d.body}</div>
                  </div>
                  <span className="ml-3 whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(d.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Generate a report</CardTitle>
          <CardDescription>Click a rider — defaults to this month ({month.label}). You can change the dates on the report page.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-2">Rider</th>
                  <th className="pb-2">Batch</th>
                  <th className="pb-2">Level</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {riders.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/40">
                    <td className="py-2 font-medium">
                      {r.firstName} {r.lastName}
                    </td>
                    <td className="py-2">{r.batch?.name ?? "—"}</td>
                    <td className="py-2">
                      <Badge variant="outline">{r.currentLevel ?? "Beginner"}</Badge>
                    </td>
                    <td className="py-2 text-right">
                      <Link
                        href={`/reports/${r.id}?from=${month.from}&to=${month.to}`}
                        className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs hover:bg-muted"
                      >
                        <FileText className="h-3 w-3" /> Generate
                      </Link>
                    </td>
                  </tr>
                ))}
                {riders.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-muted-foreground">
                      No active riders.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

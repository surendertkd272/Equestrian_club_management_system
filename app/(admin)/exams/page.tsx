import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccessRoute } from "@/components/shell/sidebar-nav";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "outline" | "destructive"> = {
  scheduled: "outline",
  in_progress: "warning",
  completed: "success",
};

export default async function ExamsPage({
  searchParams,
}: {
  searchParams: { status?: string; level?: string };
}) {
  const session = (await getSession())!;
  if (!canAccessRoute(session.role, "/exams")) redirect("/dashboard");
  const centreId = scopeCentre(session);

  const where: any = { ...centreWhere(centreId) };
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.level) where.level = Number(searchParams.level);
  if (session.role === "EXAMINER") where.examinerId = session.userId;

  const [exams, templates, catalog] = await Promise.all([
    prisma.exam.findMany({
      where,
      include: { rider: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ date: "desc" }, { time: "asc" }],
      take: 100,
    }),
    prisma.scoringTemplate.findMany({
      where: centreWhere(centreId),
      select: { levelKey: true },
      distinct: ["levelKey"],
      orderBy: { levelKey: "asc" },
    }),
    prisma.examLevel.findMany({
      where: { active: true },
      select: { orderIndex: true, code: true, name: true, discipline: true },
    }),
  ]);

  const canSchedule = ["SUPER_ADMIN", "CENTRE_MANAGER"].includes(session.role);
  const canManageTemplates = session.role === "SUPER_ADMIN";
  // Lookup table: Exam.level (Int) → "discipline · code — name". Falls
  // back to "L<n>" when the catalog has no matching row.
  const levelLabel = new Map<number, string>();
  for (const c of catalog) {
    levelLabel.set(
      c.orderIndex,
      `${c.discipline === "general" ? "" : c.discipline + " · "}${c.code} — ${c.name}`,
    );
  }
  const levels = Array.from(new Set(templates.map((t) => t.levelKey))).sort();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Exams</h1>
          <p className="text-sm text-muted-foreground">
            Level-promotion exams. {session.role === "EXAMINER" ? "Showing exams assigned to you." : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageTemplates && (
            <Button asChild variant="outline">
              <Link href="/exams/templates">Manage templates</Link>
            </Button>
          )}
          {canSchedule && (
            <>
              <Button asChild variant="outline">
                <Link href="/exams/sittings/new">Schedule sitting</Link>
              </Button>
              <Button asChild>
                <Link href="/exams/new">
                  <Plus className="h-4 w-4" /> Schedule exam
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Status</label>
              <select
                name="status"
                defaultValue={searchParams.status ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                <option value="scheduled">Scheduled</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Level</label>
              <select
                name="level"
                defaultValue={searchParams.level ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                {levels.map((l) => (
                  <option key={l} value={l}>
                    Level {l}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm" variant="outline">
              Filter
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Time</th>
                  <th className="pb-2">Rider</th>
                  <th className="pb-2">Examiner</th>
                  <th className="pb-2">Level</th>
                  <th className="pb-2">Score</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {exams.map((e) => (
                  <tr key={e.id} className="border-t hover:bg-muted/40">
                    <td className="py-2">{formatDate(e.date)}</td>
                    <td className="py-2">{e.time}</td>
                    <td className="py-2 font-medium">
                      {e.rider.firstName} {e.rider.lastName}
                    </td>
                    <td className="py-2">{e.examinerName}</td>
                    <td className="py-2">{levelLabel.get(e.level) ?? `L${e.level}`}</td>
                    <td className="py-2">
                      {e.totalScore !== null ? (
                        <span className="font-mono">{e.totalScore}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {e.passed === true && <Badge variant="success" className="ml-2">Pass</Badge>}
                      {e.passed === false && <Badge variant="destructive" className="ml-2">Fail</Badge>}
                    </td>
                    <td className="py-2">
                      <Badge variant={STATUS_VARIANT[e.status] ?? "outline"}>{e.status.replace("_", " ")}</Badge>
                    </td>
                    <td className="py-2 text-right">
                      <Link href={`/exams/${e.id}`} className="text-xs text-primary underline">
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
                {exams.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-muted-foreground">
                      No exams yet.
                      {canSchedule && (
                        <>
                          {" "}
                          <Link href="/exams/new" className="text-primary underline">
                            Schedule the first one
                          </Link>
                          .
                        </>
                      )}
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

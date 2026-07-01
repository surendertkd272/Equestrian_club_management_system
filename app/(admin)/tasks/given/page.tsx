import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { tenantWhere, scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { startOfTodayForCentre } from "@/lib/centre-tz";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { formatEnum, roleLabel } from "@/lib/labels";
export const dynamic = "force-dynamic";

// "Tasks Given and Tasks Completed" (client ask) — the delegation view. Shows
// every task the current user handed down (assignedById = me), split into
// outstanding vs completed, with who it's on and when it was finished.
// Super Admin can optionally see everything delegated at the centre.
export default async function GivenTasksPage({
  searchParams,
}: {
  searchParams: { scope?: string };
}) {
  const session = (await getSession())!;
  if (!can(session.role, "task.assign")) redirect("/tasks");

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const centreId = scopeCentre(session);
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  // HQ users can flip to "all delegated at this centre"; everyone else only
  // sees what they personally assigned.
  const allScope = isHQ && searchParams.scope === "all";

  const where: any = { ...tenantWhere(centreId, orgId) };
  if (!allScope) where.assignedById = session.userId;
  else where.assignedById = { not: null };

  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    take: 300,
  });

  // Resolve assignee + delegator names in one batch.
  const userIds = Array.from(
    new Set(tasks.flatMap((t) => [t.assigneeId, t.assignedById].filter(Boolean) as string[])),
  );
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, role: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));
  const todayStart = await startOfTodayForCentre(centreId); // centre-local overdue boundary

  const completed = tasks.filter((t) => t.status === "done");
  const outstanding = tasks.filter((t) => t.status !== "done");
  const completionRate = tasks.length > 0 ? Math.round((completed.length / tasks.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/tasks">
            <ChevronLeft className="h-4 w-4" /> Task board
          </Link>
        </Button>
        {isHQ && (
          <Button asChild variant="outline" size="sm">
            <Link href={allScope ? "/tasks/given" : "/tasks/given?scope=all"}>
              {allScope ? "Showing: all delegated" : "Show all delegated at centre"}
            </Link>
          </Button>
        )}
      </div>

      <div>
        <h1 className="text-2xl font-bold">Tasks Given &amp; Completed</h1>
        <p className="text-sm text-muted-foreground">
          {allScope ? "Every delegated task at this centre" : "Tasks you delegated"} ·{" "}
          {completed.length}/{tasks.length} completed ({completionRate}%).
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Given (Total)" value={tasks.length} />
        <Kpi label="Outstanding" value={outstanding.length} tone={outstanding.length > 0 ? "amber" : undefined} />
        <Kpi label="Completed" value={completed.length} tone="green" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Outstanding ({outstanding.length})</CardTitle>
          <CardDescription>Delegated tasks not yet done.</CardDescription>
        </CardHeader>
        <CardContent>
          {outstanding.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">Nothing outstanding. 🎉</div>
          ) : (
            <TaskTable tasks={outstanding} userMap={userMap} showCompleted={false} todayStart={todayStart} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Completed ({completed.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {completed.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">None completed yet.</div>
          ) : (
            <TaskTable tasks={completed} userMap={userMap} showCompleted todayStart={todayStart} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TaskTable({
  tasks,
  userMap,
  showCompleted,
  todayStart,
}: {
  tasks: { id: string; title: string; assigneeId: string | null; dueAt: Date | null; status: string; completedAt: Date | null; recurrence: string | null }[];
  userMap: Map<string, { id: string; name: string; role: string }>;
  showCompleted: boolean;
  todayStart: Date;
}) {
  return (
    <ResponsiveTable
      rows={tasks}
      getRowKey={(t) => t.id}
      columns={[
        {
          key: "task",
          header: "Task",
          primary: true,
          cell: (t) => <span className="font-medium">{t.title}</span>,
        },
        {
          key: "assignee",
          header: "Assigned To",
          cell: (t) => {
            const assignee = t.assigneeId ? userMap.get(t.assigneeId) : null;
            return assignee ? (
              <span>
                {assignee.name}{" "}
                <span className="text-[11px] text-muted-foreground">
                  {roleLabel(assignee.role)}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">Unassigned</span>
            );
          },
        },
        {
          key: "recurrence",
          header: "Recurrence",
          cell: (t) => (
            <span className="text-xs capitalize text-muted-foreground">{t.recurrence ?? "once"}</span>
          ),
        },
        {
          key: "when",
          header: showCompleted ? "Completed" : "Due",
          cell: (t) => {
            const overdue = !showCompleted && t.dueAt && t.dueAt < todayStart;
            return (
              <span className={`text-xs ${overdue ? "font-semibold text-amber-700" : ""}`}>
                {showCompleted
                  ? t.completedAt
                    ? formatDate(t.completedAt)
                    : "—"
                  : t.dueAt
                    ? `${formatDate(t.dueAt)}${overdue ? " · overdue" : ""}`
                    : "—"}
              </span>
            );
          },
        },
        {
          key: "status",
          header: "Status",
          cell: (t) => (
            <Badge
              variant={t.status === "done" ? "success" : t.status === "in_progress" ? "warning" : "outline"}
            >
              {formatEnum(t.status)}
            </Badge>
          ),
        },
      ]}
    />
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "amber" | "green" }) {
  const cls = tone === "amber" ? "text-amber-700" : tone === "green" ? "text-emerald-600" : "";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

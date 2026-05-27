import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { can } from "@/lib/permissions";
import { deriveOverdue, deriveEscalated } from "@/lib/schemas/task";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { TaskCard } from "./task-card";
import { AssigneeFilter } from "./assignee-filter";

export const dynamic = "force-dynamic";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: { mine?: string; assignee?: string };
}) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);
  const canAssign = can(session.role, "task.assign");

  const where: any = { ...centreWhere(centreId) };
  if (searchParams.mine === "1") {
    where.assigneeId = session.userId;
  } else if (canAssign && searchParams.assignee) {
    // "unassigned" is a sentinel for tasks with no owner.
    where.assigneeId = searchParams.assignee === "unassigned" ? null : searchParams.assignee;
  }

  const [tasks, assignees] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      take: 200,
    }),
    prisma.user.findMany({
      where: { centreId: centreId ?? undefined, status: "active" },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const assigneeMap = new Map(assignees.map((u) => [u.id, u]));

  const now = new Date();
  const annotated = tasks.map((t) => ({
    ...t,
    overdue: deriveOverdue(t.dueAt, t.status, now),
    escalated: deriveEscalated(t.dueAt, t.status, now),
    assignee: t.assigneeId ? assigneeMap.get(t.assigneeId) ?? null : null,
  }));

  const todo = annotated.filter((t) => t.status === "open");
  const inProgress = annotated.filter((t) => t.status === "in_progress");
  // Done lane: only today's completions, otherwise it grows forever.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const done = annotated.filter((t) => t.status === "done");
  const doneToday = done; // upgrade later: filter by completedAt once we track it

  const overdueCount = todo.filter((t) => t.overdue).length;
  const escalatedCount = todo.filter((t) => t.escalated).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
          <p className="text-sm text-muted-foreground">
            {tasks.length} total · {overdueCount} overdue
            {escalatedCount > 0 && <span className="ml-1 text-destructive">· {escalatedCount} escalated</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Button asChild variant={searchParams.mine === "1" ? "default" : "outline"} size="sm">
            <Link href={searchParams.mine === "1" ? "/tasks" : "/tasks?mine=1"}>
              {searchParams.mine === "1" ? "Showing: my tasks" : "Show only mine"}
            </Link>
          </Button>
          {/* Userwise filter — managers/admins narrow the board to one
              assignee (or unassigned). Hidden while "mine" is active to keep
              the two filters from fighting. */}
          {canAssign && searchParams.mine !== "1" && <AssigneeFilter assignees={assignees} />}
          {canAssign && (
            <Button asChild>
              <Link href="/tasks/new">
                <Plus className="h-4 w-4" /> New task
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Lane title="To-do" count={todo.length} accent="border-l-amber-500">
          {todo.length === 0 ? (
            <Empty msg="No open tasks. 🎉" />
          ) : (
            todo.map((t) => <TaskCard key={t.id} task={t} myUserId={session.userId} canAssign={canAssign} />)
          )}
        </Lane>
        <Lane title="In progress" count={inProgress.length} accent="border-l-blue-500">
          {inProgress.length === 0 ? (
            <Empty msg="Nothing in progress." />
          ) : (
            inProgress.map((t) => <TaskCard key={t.id} task={t} myUserId={session.userId} canAssign={canAssign} />)
          )}
        </Lane>
        <Lane title="Done" count={doneToday.length} accent="border-l-emerald-500">
          {doneToday.length === 0 ? (
            <Empty msg="Nothing completed yet." />
          ) : (
            doneToday.map((t) => <TaskCard key={t.id} task={t} myUserId={session.userId} canAssign={canAssign} />)
          )}
        </Lane>
      </div>
    </div>
  );
}

function Lane({
  title,
  count,
  accent,
  children,
}: {
  title: string;
  count: number;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={`border-l-4 ${accent}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <Badge variant="outline">{count}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

function Empty({ msg }: { msg: string }) {
  return <p className="py-6 text-center text-xs text-muted-foreground">{msg}</p>;
}

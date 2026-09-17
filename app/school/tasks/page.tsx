import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/utils";
import { schoolContext } from "@/lib/school-portal";
import { NoCentreCard } from "../no-centre";
import { TasksClient, type SchoolTask } from "./tasks-client";

export const dynamic = "force-dynamic";

// The school's thread with head office.
//
// Scoped to the CONVERSATION, not the centre: a school sees what it raised and
// what HQ addressed to it, and nothing else on the club's task board. The
// club's internal work — stable rotas, coach assignments, salary chases — sits
// in the same table and must not appear here.

export default async function SchoolTasksPage() {
  const ctx = await schoolContext();
  if (!ctx) return <NoCentreCard />;

  const tasks = await prisma.task.findMany({
    where: {
      centreId: ctx.centreId,
      OR: [{ assignedById: ctx.userId }, { assigneeId: ctx.userId }],
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      dueAt: true,
      createdAt: true,
      assignedById: true,
    },
  });

  const now = Date.now();
  const rows: SchoolTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status === "done" ? "done" : t.status === "in_progress" ? "in_progress" : "open",
    dueAt: t.dueAt ? formatDate(t.dueAt) : null,
    createdAt: formatDate(t.createdAt),
    raisedByMe: t.assignedById === ctx.userId,
    // Overdue is derived here rather than trusted from `status`, which the
    // sweeps also write to — a task can be past its date before any sweep has
    // run, and the person waiting on it should see that immediately.
    overdue: Boolean(t.dueAt && t.status !== "done" && t.dueAt.getTime() < now),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          Between {ctx.title} and {ctx.centreName} head office
        </p>
      </div>
      <TasksClient tasks={rows} />
    </div>
  );
}

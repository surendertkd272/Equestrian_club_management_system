import { prisma } from "../prisma";
import { SweepResult } from "./shared";

const RECURRENCES = ["daily", "weekly", "monthly"];

// Advance a due date by one recurrence interval, in UTC. Monthly clamps to the
// end of the target month (e.g. Jan 31 + 1 month → Feb 28/29) so we never roll
// over into the following month.
function addInterval(d: Date, recurrence: string): Date {
  const x = new Date(d);
  if (recurrence === "daily") {
    x.setUTCDate(x.getUTCDate() + 1);
  } else if (recurrence === "weekly") {
    x.setUTCDate(x.getUTCDate() + 7);
  } else if (recurrence === "monthly") {
    const day = x.getUTCDate();
    x.setUTCDate(1);
    x.setUTCMonth(x.getUTCMonth() + 1);
    const daysInTargetMonth = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
    x.setUTCDate(Math.min(day, daysInTargetMonth));
  }
  return x;
}

// Recurrence expander (H1). Previously `recurrence` was a stored label with no
// engine — a "weekly" task fired exactly once, ever. This sweep spawns the next
// occurrence of any recurring task whose dueAt has passed and which hasn't
// spawned yet (recurrenceSpawnedAt is the idempotency guard — exactly one
// successor per task, so a double/overlapping cron run can't duplicate). The
// successor carries the recurrence forward and spawns its own when ITS dueAt
// passes, so the chain self-propagates one period per run (a long-missed daily
// task catches up one occurrence per run, which converges).
export async function sweepRecurringTasks(): Promise<SweepResult> {
  const now = new Date();

  const tasks = await prisma.task.findMany({
    where: {
      recurrence: { in: RECURRENCES },
      recurrenceSpawnedAt: null,
      dueAt: { not: null, lt: now },
    },
    select: {
      id: true,
      centreId: true,
      title: true,
      description: true,
      kind: true,
      assigneeId: true,
      assignedById: true,
      dueAt: true,
      recurrence: true,
    },
  });

  let spawned = 0;
  let failed = 0;
  for (const t of tasks) {
    try {
      const nextDue = addInterval(t.dueAt!, t.recurrence!);
      await prisma.$transaction([
        prisma.task.create({
          data: {
            centreId: t.centreId,
            title: t.title,
            description: t.description,
            kind: t.kind,
            assigneeId: t.assigneeId,
            assignedById: t.assignedById,
            dueAt: nextDue,
            // Fresh immutable overdue anchor for the new occurrence (H7).
            overdueSince: nextDue,
            recurrence: t.recurrence,
            status: "open",
          },
        }),
        prisma.task.update({ where: { id: t.id }, data: { recurrenceSpawnedAt: now } }),
      ]);
      spawned++;
    } catch (err) {
      console.error("[recurring_tasks] failed", { taskId: t.id, err });
      failed++;
    }
  }

  return { job: "recurring_tasks", scanned: tasks.length, notified: spawned, skipped: 0, details: { spawned, failed } };
}

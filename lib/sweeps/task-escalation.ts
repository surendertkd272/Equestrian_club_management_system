import { prisma } from "../prisma";
import { notifyMany } from "../notify";
import { SweepResult, centreManagerId } from "./shared";

// Task escalation (H1). A delegated task that isn't completed in time should
// surface to oversight — previously "escalation" was a UI-only colour with no
// engine behind it, so nobody was ever told. This sweep finds tasks that are
// >24h past their overdue anchor (overdueSince — the immutable clock from H7,
// falling back to dueAt for legacy rows) and still open/in_progress, notifies
// the delegator + the centre manager once, and stamps escalatedAt so it never
// re-fires. Per-row try/catch so one bad row can't sink the batch.
export async function sweepTaskEscalation(): Promise<SweepResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const tasks = await prisma.task.findMany({
    where: {
      status: { in: ["open", "in_progress"] },
      escalatedAt: null,
      OR: [
        { overdueSince: { lt: cutoff } },
        { overdueSince: null, dueAt: { lt: cutoff } },
      ],
    },
    select: {
      id: true,
      title: true,
      centreId: true,
      assignedById: true,
      dueAt: true,
      overdueSince: true,
    },
  });

  let notified = 0;
  let skipped = 0;
  let failed = 0;
  for (const t of tasks) {
    try {
      const mgrId = await centreManagerId(t.centreId);
      // Escalate to oversight: the delegator (owns the outcome) + the centre
      // manager. Not the assignee — they already hold the task; escalation is
      // about visibility above them.
      const recipients = [t.assignedById, mgrId].filter((x): x is string => !!x);
      // Always stamp escalatedAt so we don't re-scan this row every night, even
      // if there's no one to notify (orphaned/manager-less centre).
      await prisma.task.update({ where: { id: t.id }, data: { escalatedAt: now } });
      if (recipients.length === 0) {
        skipped++;
        continue;
      }
      const anchor = t.overdueSince ?? t.dueAt;
      await notifyMany(recipients, {
        centreId: t.centreId,
        type: "task.escalated",
        title: `Task overdue: ${t.title}`,
        body: `This task has been overdue since ${anchor ? anchor.toISOString().slice(0, 10) : "its due date"} and wasn't completed in time. Please reassign or follow up.`,
        link: "/tasks",
        payload: { taskId: t.id },
      });
      notified++;
    } catch (err) {
      console.error("[task_escalation] failed", { taskId: t.id, err });
      failed++;
    }
  }

  return { job: "task_escalation", scanned: tasks.length, notified, skipped, details: { failed } };
}

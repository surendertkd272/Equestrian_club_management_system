import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { updateTaskSchema } from "@/lib/schemas/task";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { formatDate } from "@/lib/utils";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "tasks");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const task = await prisma.task.findUnique({ where: { id: params.id } });
  if (!task) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence26 = await centreFence(session, task.centreId);
  if (fence26) {
    return NextResponse.json({ error: fence26 }, { status: 403 });
  }

  // Field edits (title/description/dueAt/reassign) require task.assign.
  // Status flips and proof attachments require task.complete OR the assignee themselves OR task.assign.
  const isAssignee = task.assigneeId && task.assigneeId === session.userId;
  const isCompleteOnly =
    (d.status !== undefined || d.proofUrl !== undefined) &&
    d.title === undefined &&
    d.description === undefined &&
    d.assigneeId === undefined &&
    d.dueAt === undefined;

  if (isCompleteOnly) {
    if (!(isAssignee || can(session.role, "task.complete") || can(session.role, "task.assign"))) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
  } else {
    if (!can(session.role, "task.assign")) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
  }

  if (d.assigneeId !== undefined && d.assigneeId !== null) {
    const u = await prisma.user.findUnique({ where: { id: d.assigneeId } });
    if (!u || u.centreId !== task.centreId) {
      return NextResponse.json({ error: "INVALID_ASSIGNEE" }, { status: 400 });
    }
  }

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: {
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.description !== undefined ? { description: d.description || null } : {}),
      ...(d.assigneeId !== undefined ? { assigneeId: d.assigneeId } : {}),
      ...(d.dueAt !== undefined ? { dueAt: d.dueAt ? new Date(d.dueAt) : null } : {}),
      // Overdue anchor: set on FIRST due-date assignment, clear if the due date
      // is removed, but NEVER overwrite an existing anchor on a dueAt nudge —
      // that's what stops a forward nudge from erasing overdue/escalated state.
      ...(d.dueAt !== undefined
        ? d.dueAt === null
          ? { overdueSince: null }
          : task.overdueSince == null
            ? { overdueSince: new Date(d.dueAt) }
            : {}
        : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.proofUrl !== undefined ? { proofUrl: d.proofUrl } : {}),
      // Stamp/clear completedAt as the task moves in and out of "done" so the
      // "Tasks Completed" view can show when it was finished.
      ...(d.status === "done" && task.status !== "done" ? { completedAt: new Date() } : {}),
      ...(d.status !== undefined && d.status !== "done" ? { completedAt: null } : {}),
    },
  });

  await audit({
    userId: session.userId,
    action: d.status ? `task.${d.status}` : "task.update",
    tableName: "task",
    rowId: task.id,
    before: task,
    after: updated,
  });

  // Hand-over notifications. Creating a task notifies the assignee, but
  // REASSIGNING one notified nobody: the new owner never learned they had it,
  // and the previous owner kept a "New task" notification for work that was no
  // longer theirs. Both sides need to know a task changed hands.
  if (d.assigneeId !== undefined && d.assigneeId !== task.assigneeId) {
    if (d.assigneeId) {
      await notify({
        userId: d.assigneeId,
        centreId: task.centreId,
        type: "task.assigned",
        title: `Task reassigned to you: ${updated.title}`,
        body: updated.dueAt ? `Due ${formatDate(updated.dueAt)}.` : "No due date set.",
        link: `/tasks`,
      });
    }
    if (task.assigneeId) {
      await notify({
        userId: task.assigneeId,
        centreId: task.centreId,
        type: "task.reassigned_away",
        title: `No longer yours: ${updated.title}`,
        body: `${session.name} moved this task to someone else.`,
        link: `/tasks`,
      });
    }
  }

  return NextResponse.json({ ok: true, status: updated.status });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "tasks");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "task.assign")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const task = await prisma.task.findUnique({ where: { id: params.id } });
  if (!task) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence26 = await centreFence(session, task.centreId);
  if (fence26) {
    return NextResponse.json({ error: fence26 }, { status: 403 });
  }

  await prisma.task.delete({ where: { id: task.id } });
  await audit({
    userId: session.userId,
    action: "delete",
    tableName: "task",
    rowId: task.id,
    before: task,
  });
  return NextResponse.json({ ok: true });
}

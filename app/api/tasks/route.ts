import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { createTaskSchema } from "@/lib/schemas/task";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { resolveWriteCentre } from "@/lib/resolve-centre";

function parseLocalDate(s: string): Date {
  return new Date(s);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "tasks");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "task.assign")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  // Resolve centre via picker (HQ) / own centre / body fallback. Fixes ADMIN
  // (previously blocked) and replaces the unmapped "centreId required" string.
  const resolved = await resolveWriteCentre(session, body);
  if (resolved.error) return resolved.error;
  const { centreId } = resolved;

  if (d.assigneeId) {
    const assignee = await prisma.user.findUnique({ where: { id: d.assigneeId } });
    if (!assignee || assignee.centreId !== centreId) {
      return NextResponse.json({ error: "INVALID_ASSIGNEE" }, { status: 400 });
    }
  }

  const task = await prisma.task.create({
    data: {
      centreId,
      title: d.title,
      description: d.description || null,
      kind: d.kind ?? null,
      assigneeId: d.assigneeId ?? null,
      // Record the delegator so the "Tasks Given" view + delegation audit
      // can show who handed this down.
      assignedById: session.userId,
      dueAt: d.dueAt ? parseLocalDate(d.dueAt) : null,
      // Freeze the overdue anchor at the first due date (immune to later nudges).
      overdueSince: d.dueAt ? parseLocalDate(d.dueAt) : null,
      recurrence: d.recurrence,
      status: "open",
    },
  });

  await audit({
    userId: session.userId,
    action: "create",
    tableName: "task",
    rowId: task.id,
    after: { title: task.title, assigneeId: task.assigneeId, dueAt: task.dueAt },
  });

  if (task.assigneeId && task.assigneeId !== session.userId) {
    await notify({
      userId: task.assigneeId,
      centreId,
      type: "task.assigned",
      title: `New task: ${task.title}`,
      body: task.dueAt
        ? `Due ${task.dueAt.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}.${task.description ? ` ${task.description}` : ""}`
        : task.description ?? "No due date set.",
      link: `/tasks`,
      payload: { taskId: task.id },
    });
  }

  return NextResponse.json({ id: task.id });
}

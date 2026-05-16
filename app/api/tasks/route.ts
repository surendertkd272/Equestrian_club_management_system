import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createTaskSchema } from "@/lib/schemas/task";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";

function parseLocalDate(s: string): Date {
  return new Date(s);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "task.assign")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  if (!session.centreId && session.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "NO_CENTRE" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const centreId = session.centreId ?? (body?.centreId as string | undefined);
  if (!centreId) return NextResponse.json({ error: "centreId required" }, { status: 400 });

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
      dueAt: d.dueAt ? parseLocalDate(d.dueAt) : null,
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

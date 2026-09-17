import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { notifyHq } from "@/lib/notify";

// Tasks between a partner school and the club's HQ.
//
// A DEDICATED route rather than opening /api/tasks to the school role, and
// that is the whole design. The general task API is guarded by task.assign,
// which lets the holder assign work to anybody at the centre — handing that to
// an external partner would let a school direct the club's coaches and grooms.
//
// What a school may actually do is narrow: raise something with HQ, comment on
// progress by moving their own item along, and close their own request. Those
// three verbs are what this file implements, and nothing here can name an
// assignee the caller chose.

const createSchema = z.object({
  title: z.string().trim().min(3, "Say what you need in a few words").max(200),
  description: z.string().trim().max(4000).optional(),
  dueAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

const updateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["open", "in_progress", "done"]),
});

/** The school's own thread: what they raised, and what HQ assigned to them. */
function visibleTo(userId: string, centreId: string) {
  return {
    centreId,
    OR: [{ assignedById: userId }, { assigneeId: userId }],
  };
}

async function schoolSession() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) };
  if (session.role !== "SCHOOL_ADMINISTRATOR") {
    return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  }
  if (!session.centreId) {
    return {
      error: NextResponse.json(
        { error: "NO_CENTRE", message: "Your account isn't linked to a club yet." },
        { status: 400 },
      ),
    };
  }
  return { session, centreId: session.centreId };
}

export async function POST(req: NextRequest) {
  const s = await schoolSession();
  if (s.error) return s.error;
  const { session, centreId } = s;

  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Addressed to HQ, and only ever to HQ. assigneeId is deliberately NOT
  // taken from the request: a school choosing its own assignee is how this
  // becomes a channel for tasking the club's staff directly.
  const task = await prisma.task.create({
    data: {
      centreId,
      title: parsed.data.title,
      description: parsed.data.description || null,
      kind: "school_request",
      assignedById: session.userId,
      assigneeId: null, // unassigned: HQ picks it up on their own board
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      overdueSince: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      status: "open",
    },
  });

  // Tell HQ. A request nobody is told about is a request nobody answers, and
  // this is a partner waiting on the other side of it.
  //
  // Org-scoped rather than notifyRole: SUPER_ADMIN and ADMIN carry
  // centreId = null, so a centre-filtered notification silently reaches none
  // of them — the recurring bug in this codebase.
  const centre = await prisma.centre.findUnique({
    where: { id: centreId },
    select: { name: true, orgId: true },
  });
  if (centre) {
    await notifyHq(centre.orgId, {
      type: "task.school_request",
      title: `School request — ${centre.name}`,
      body: `${session.name}: ${parsed.data.title}`,
      link: "/tasks",
      payload: { taskId: task.id },
    });
  }

  await audit({
    userId: session.userId,
    action: "task.school_request",
    tableName: "task",
    rowId: task.id,
    after: { title: task.title, centreId },
  });

  return NextResponse.json({ id: task.id });
}

export async function PATCH(req: NextRequest) {
  const s = await schoolSession();
  if (s.error) return s.error;
  const { session, centreId } = s;

  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Only a task on their own thread, at their own centre. Without both checks
  // a school could close any task at any club by guessing an id.
  const task = await prisma.task.findFirst({
    where: { id: parsed.data.id, ...visibleTo(session.userId, centreId) },
    select: { id: true, status: true, title: true },
  });
  if (!task) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: parsed.data.status,
      completedAt: parsed.data.status === "done" ? new Date() : null,
    },
  });
  await audit({
    userId: session.userId,
    action: "task.update",
    tableName: "task",
    rowId: task.id,
    before: { status: task.status },
    after: { status: parsed.data.status, title: task.title },
  });

  return NextResponse.json({ ok: true });
}

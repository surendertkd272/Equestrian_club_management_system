import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { sendExamResultEmail } from "@/lib/result-email";

// POST /api/exams/send-results — email the results of a whole sitting or exam
// day to the families, passes and not. The result email went one certificate
// at a time (a 180-pass day was 180 clicks) and never to riders who didn't pass.
//
// Sends a batch per call and reports what's left, so the page can loop
// without any one request outliving the function time limit. Skips results
// already emailed unless `resend` is set.
const BATCH = 30;
const schema = z.object({
  scope: z.enum(["sitting", "day"]),
  id: z.string().min(1),
  resend: z.boolean().optional(),
  // With resend: only results emailed before this moment, so a resend run
  // doesn't loop over the ones it has just sent.
  before: z.string().datetime().optional(),
  // Cursor: carry on after the last exam the previous batch looked at, so a
  // family with no email doesn't come round again on every call.
  after: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "exam.schedule")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  const d = parsed.data;

  const owner =
    d.scope === "sitting"
      ? await prisma.examSitting.findUnique({ where: { id: d.id }, select: { centreId: true } })
      : await prisma.examDay.findUnique({ where: { id: d.id }, select: { centreId: true } });
  if (!owner) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await centreFence(session, owner.centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });

  const inScope = d.scope === "sitting" ? { sittingId: d.id } : { sitting: { examDayId: d.id } };
  const due = {
    ...inScope,
    status: "completed",
    ...(d.resend
      ? d.before
        ? { OR: [{ resultEmailSentAt: null }, { resultEmailSentAt: { lt: new Date(d.before) } }] }
        : {}
      : { resultEmailSentAt: null }),
  };
  const batch = await prisma.exam.findMany({
    where: { ...due, ...(d.after ? { id: { gt: d.after } } : {}) },
    select: { id: true, rider: { select: { firstName: true, lastName: true } } },
    orderBy: { id: "asc" },
    take: BATCH,
  });
  let sent = 0;
  const noEmail: string[] = [];
  for (const e of batch) {
    const r = await sendExamResultEmail(e.id, session.userId);
    if (r.ok) sent++;
    else if (r.code === "NO_PARENT_EMAIL") noEmail.push(`${e.rider.firstName} ${e.rider.lastName}`);
  }
  const cursor = batch.length ? batch[batch.length - 1].id : (d.after ?? null);
  const remaining = cursor
    ? await prisma.exam.count({ where: { ...due, id: { gt: cursor } } })
    : await prisma.exam.count({ where: due });
  await audit({
    userId: session.userId,
    action: "exam.results_emailed",
    tableName: d.scope === "sitting" ? "examSitting" : "examDay",
    rowId: d.id,
    after: { sent, noEmail: noEmail.length, remaining, resend: !!d.resend },
  });
  return NextResponse.json({ ok: true, sent, noEmail, remaining, cursor });
}

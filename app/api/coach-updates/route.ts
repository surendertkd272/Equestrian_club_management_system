// Coach's daily 5-minute update. Upserts one row per (centre, coach, date)
// so re-saving the same day edits in place rather than duplicating.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { coachUpdateSchema } from "@/lib/schemas/coach-update";
import { coachUpdateDateKey } from "@/lib/coach-update";
import { notifyCentreManager, notifyRole } from "@/lib/notify";
import { sendEmail, renderEmail } from "@/lib/email";

const CAN_LOG = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "CENTRE_MANAGER",
  "HEAD_COACH",
  "COACH",
]);

const escapeHtml = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

// Alert the centre manager + head coaches when a coach flags an injury/concern
// in their daily update. In-app for everyone, email as a second channel. Fired
// only when the note is newly added or changed (see caller), so re-saving the
// same day doesn't re-ping.
async function alertInjuryFlag(opts: {
  centreId: string;
  coachName: string;
  coachUserId: string;
  note: string;
  updateId: string;
}) {
  const body = opts.note.slice(0, 160);
  const link = "/daily-update/team";
  await notifyCentreManager(opts.centreId, {
    type: "coach_update.injury",
    title: `Injury flagged by ${opts.coachName}`,
    body,
    link,
    payload: { updateId: opts.updateId, coachUserId: opts.coachUserId },
  });
  await notifyRole("HEAD_COACH", {
    centreId: opts.centreId,
    type: "coach_update.injury",
    title: `Injury flagged by ${opts.coachName}`,
    body,
    link,
    payload: { updateId: opts.updateId, coachUserId: opts.coachUserId },
  });

  // Email — to the manager + head coaches (skip the coach themselves).
  const [recipients, centre] = await Promise.all([
    prisma.user.findMany({
      where: {
        centreId: opts.centreId,
        status: "active",
        role: { in: ["CENTRE_MANAGER", "HEAD_COACH"] },
        id: { not: opts.coachUserId },
        email: { not: "" },
      },
      select: { email: true },
    }),
    prisma.centre.findUnique({ where: { id: opts.centreId }, select: { name: true } }),
  ]);
  await Promise.all(
    recipients
      .filter((r) => r.email)
      .map((r) =>
        sendEmail({
          to: r.email,
          subject: `⚠️ Injury flagged in daily update — ${opts.coachName}`,
          html: renderEmail({
            centreName: centre?.name,
            heading: "Injury / concern flagged",
            body: `<p><b>${escapeHtml(opts.coachName)}</b> flagged the following in today's coach update:</p>
<blockquote style="border-left:3px solid #d97706;padding-left:12px;color:#444;">${escapeHtml(opts.note)}</blockquote>
<p>Open the <b>Team Daily Updates</b> page to review and follow up. The full injury record (if any) should also be logged in the Injuries module.</p>`,
          }),
          ref: { type: "coach_update.injury", rowId: opts.updateId },
        }),
      ),
  );
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!CAN_LOG.has(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const centreId = session.centreId;
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = coachUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const dateKey = coachUpdateDateKey(d.date);

  // Grab the prior injury note so we only alert when it's newly added/changed
  // (re-saving the same day shouldn't re-ping the manager).
  const prior = await prisma.coachDailyUpdate.findUnique({
    where: {
      centreId_coachUserId_date: { centreId, coachUserId: session.userId, date: dateKey },
    },
    select: { injuriesNoted: true },
  });

  const row = await prisma.coachDailyUpdate.upsert({
    where: {
      centreId_coachUserId_date: {
        centreId,
        coachUserId: session.userId,
        date: dateKey,
      },
    },
    create: {
      centreId,
      coachUserId: session.userId,
      date: dateKey,
      summary: d.summary,
      horsesWorked: d.horsesWorked ?? null,
      ridersTaught: d.ridersTaught ?? null,
      injuriesNoted: d.injuriesNoted ?? null,
      minutesSpent: d.minutesSpent ?? null,
    },
    update: {
      summary: d.summary,
      horsesWorked: d.horsesWorked ?? null,
      ridersTaught: d.ridersTaught ?? null,
      injuriesNoted: d.injuriesNoted ?? null,
      minutesSpent: d.minutesSpent ?? null,
    },
  });

  await audit({
    userId: session.userId,
    action: "coach_update.save",
    tableName: "coachDailyUpdate",
    rowId: row.id,
    after: { date: d.date, horsesWorked: d.horsesWorked ?? null, hasInjuries: !!d.injuriesNoted },
  });

  // Injury/concern flagged → alert the manager + head coaches. Only when the
  // note is new or changed since the last save of this day's entry.
  const newNote = (d.injuriesNoted ?? "").trim();
  if (newNote && newNote !== (prior?.injuriesNoted ?? "").trim()) {
    await alertInjuryFlag({
      centreId,
      coachName: session.name,
      coachUserId: session.userId,
      note: newNote,
      updateId: row.id,
    });
  }

  return NextResponse.json({ ok: true, id: row.id });
}

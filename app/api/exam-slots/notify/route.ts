import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { notifyRiderAndParents } from "@/lib/notify";
import { sendEmail, renderEmail } from "@/lib/email";
import { sendSms, isSmsConfigured } from "@/lib/sms";
import { resultRecipients, RESULT_RECIPIENT_SELECT } from "@/lib/result-recipients";

// POST — tell each family their child's exam slot, or what changed.
//
// Families saw the time only if they opened the parent page; moving the day
// or re-doing the running order told nobody. Each exam remembers the slot last
// sent (Exam.slotNotified), so a second run sends only new and changed times,
// worded as a change. In-app always; email when there's an address; SMS when a
// provider is set up — contact details are optional, so none is required.
const BATCH = 40;
const schema = z.object({ scope: z.enum(["sitting", "day"]), id: z.string().min(1), after: z.string().optional() });
const slotOf = (date: Date, time: string) => `${date.toISOString().slice(0, 10)} ${time}`;

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
      ? await prisma.examSitting.findUnique({ where: { id: d.id }, select: { centreId: true, centre: { select: { name: true } } } })
      : await prisma.examDay.findUnique({ where: { id: d.id }, select: { centreId: true, centre: { select: { name: true } } } });
  if (!owner) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await centreFence(session, owner.centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });

  const exams = await prisma.exam.findMany({
    where: {
      ...(d.scope === "sitting" ? { sittingId: d.id } : { sitting: { examDayId: d.id } }),
      status: "scheduled",
      sitting: { slotMinutes: { not: null } },
      ...(d.after ? { id: { gt: d.after } } : {}),
    },
    orderBy: { id: "asc" },
    select: {
      id: true, date: true, time: true, runOrder: true, level: true, riderId: true, slotNotified: true,
      horseAllocation: { select: { horse: { select: { name: true } } } },
      rider: { select: { firstName: true, lastName: true, fatherPhone: true, motherPhone: true, mobile: true, ...RESULT_RECIPIENT_SELECT } },
    },
  });
  const due = exams.filter((e) => e.slotNotified !== slotOf(e.date, e.time));
  const batch = due.slice(0, BATCH);
  let sent = 0;
  let changed = 0;
  for (const e of batch) {
    const name = `${e.rider.firstName} ${e.rider.lastName}`;
    const when = `${e.date.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" })} at ${e.time}`;
    const isChange = !!e.slotNotified;
    const detail = `${when}${e.runOrder ? ` (#${e.runOrder} in the order)` : ""}${e.horseAllocation ? `, riding ${e.horseAllocation.horse.name}` : ""}`;
    const title = isChange ? `New time for ${name}'s Level ${e.level} exam` : `${name}'s Level ${e.level} exam time`;
    const body = `${isChange ? "Now " : ""}${detail}. Please arrive 30 minutes early.`;
    await notifyRiderAndParents(e.riderId, { centreId: owner.centreId, type: "exam.slot", title, body, link: `/parent/${e.riderId}` });
    for (const to of resultRecipients(e.rider)) {
      await sendEmail({
        to,
        subject: title,
        html: renderEmail({ centreName: owner.centre.name, heading: title, body: `<p>${body}</p>` }),
        ref: { type: "exam.slot", rowId: e.id },
      });
    }
    const phone = e.rider.fatherPhone ?? e.rider.motherPhone ?? e.rider.mobile;
    if (phone && isSmsConfigured()) {
      await sendSms({ to: phone, body: `${owner.centre.name}: ${title} — ${body}`, ref: { type: "exam.slot", rowId: e.id } });
    }
    await prisma.exam.update({ where: { id: e.id }, data: { slotNotified: slotOf(e.date, e.time), slotNotifiedAt: new Date() } });
    sent++;
    if (isChange) changed++;
  }
  const cursor = batch.length ? batch[batch.length - 1].id : null;
  const remaining = due.length - batch.length;
  await audit({ userId: session.userId, action: "exam.slots_sent", tableName: d.scope === "day" ? "examDay" : "examSitting", rowId: d.id, after: { sent, changed } });
  return NextResponse.json({ ok: true, sent, changed, remaining, cursor });
}

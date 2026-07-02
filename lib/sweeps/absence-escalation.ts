import { prisma } from "../prisma";
import { notify } from "../notify";
import { sendSms } from "../sms";
import { sendEmail, renderEmail } from "../email";
import { sendWhatsApp } from "../whatsapp";
import { SweepResult, centreManagerMap, recentlyNotified } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// Job 3: Absence escalation.
// Per spec §4.2: 3+ consecutive absences → flag. Here: any rider with 3+ "absent"
// rows in the last 5 sessions triggers a manager notification.
export async function sweepAbsenceEscalation(): Promise<SweepResult> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const recentAbsences = await prisma.attendance.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "desc" },
    select: { riderId: true, status: true, date: true },
  });

  // Group recent attendance per rider (most recent first).
  const byRider = new Map<string, typeof recentAbsences>();
  for (const a of recentAbsences) {
    if (!byRider.has(a.riderId)) byRider.set(a.riderId, []);
    byRider.get(a.riderId)!.push(a);
  }

  let notified = 0;
  let skipped = 0;
  const flaggedRiderIds: string[] = [];

  for (const [riderId, sessions] of byRider.entries()) {
    const lastFive = sessions.slice(0, 5);
    const absences = lastFive.filter((s) => s.status === "absent").length;
    if (absences < 3) continue;
    flaggedRiderIds.push(riderId);
  }

  if (flaggedRiderIds.length === 0) {
    return { job: "absence_escalation", scanned: byRider.size, notified: 0, skipped: 0 };
  }

  const riders = await prisma.rider.findMany({
    where: { id: { in: flaggedRiderIds } },
    select: { id: true, centreId: true, firstName: true, lastName: true, fatherPhone: true, motherPhone: true, mobile: true, email: true, centre: { select: { name: true } } },
  });

  // One centre lookup for the whole batch instead of one per flagged rider.
  const managers = await centreManagerMap(riders.map((r) => r.centreId));

  for (const rider of riders) {
    const mgrId = managers.get(rider.centreId) ?? null;
    if (!mgrId) {
      skipped += 1;
      continue;
    }
    if (await recentlyNotified(mgrId, "rider.absence_streak", rider.id, 7 * 24 * 60 * 60 * 1000)) {
      skipped += 1;
      continue;
    }
    const parentPhone = rider.fatherPhone ?? rider.motherPhone ?? rider.mobile;
    await notify({
      userId: mgrId,
      centreId: rider.centreId,
      type: "rider.absence_streak",
      title: `${rider.firstName} ${rider.lastName}: 3+ absences in last 5 sessions`,
      body: `Call parent at ${parentPhone} to check in. Per club policy, prolonged un-notified absence may risk membership.`,
      link: `/riders/${rider.id}`,
      payload: { riderId: rider.id },
    });
    // Parent SMS — escalation is high-priority.
    await sendSms({
      to: parentPhone,
      body: `Equiwings: ${rider.firstName} has been absent for 3+ recent sessions. Please contact the centre. Continued absences may risk membership.`,
      ref: { type: "rider.absence_streak", rowId: rider.id },
    });
    // Parent WhatsApp — pre-approved template `ew_absence_streak`.
    await sendWhatsApp({
      to: parentPhone,
      centreId: rider.centreId,
      template: { name: "ew_absence_streak", bodyParams: [`${rider.firstName} ${rider.lastName}`] },
      previewBody: `${rider.firstName} absent 3+ recent sessions — please contact centre`,
      ref: { type: "rider.absence_streak", rowId: rider.id },
    });
    // Parent email — same content, longer-form, gives them the membership-cancellation context.
    if (rider.email) {
      await sendEmail({
        to: rider.email,
        subject: `Attendance concern · ${rider.firstName} ${rider.lastName}`,
        html: renderEmail({
          centreName: rider.centre.name,
          heading: `Attendance concern`,
          body: `<p>Dear Parent / Guardian,</p>
<p><b>${rider.firstName} ${rider.lastName}</b> has been marked absent for 3 or more of the last 5 lesson sessions. We wanted to flag this early so we can resolve any issue together.</p>
<p>Please contact the centre at your earliest convenience. Per the registration agreement, <b>15 days of un-notified absence</b> may result in membership cancellation.</p>
<p>If your child is unwell or there is a scheduling concern, replying to this email is the fastest way to reach us.</p>`,
        }),
        ref: { type: "rider.absence_streak", rowId: rider.id },
      });
    }
    notified += 1;
  }

  return { job: "absence_escalation", scanned: byRider.size, notified, skipped };
}

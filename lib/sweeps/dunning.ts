import { prisma } from "../prisma";
import { sendEmail, renderEmail } from "../email";
import { SweepResult } from "./shared";

// Dunning: orgs in past_due state get reminder emails before the 7-day
// cutoff to suspended, at the day-1 / day-3 / day-5 STAGES. The clock is
// Organisation.pastDueSince (set at the past_due transition, never touched by
// unrelated writes), falling back to updatedAt for legacy rows.
//
// Stage-based, not exact-day (H4): we send the highest stage whose threshold
// has been reached but not yet sent. Previously the trigger was an exact-day
// membership test (daysOverdue ∈ {1,3,5}); if a cron run was missed on the
// exact day an org hit a threshold, that reminder was skipped FOREVER (the
// next run saw daysOverdue=6 ∉ {1,3,5}). Now a missed day is caught up on the
// next run, and dedup is per-STAGE (recorded in the audit `after`) rather than
// per-calendar-day — so a double run can't re-send and a missed run can't drop.
export async function sweepDunning(): Promise<SweepResult> {
  const now = new Date();
  const candidates = await prisma.organisation.findMany({
    where: { status: "past_due" },
    select: { id: true, name: true, billingEmail: true, pastDueSince: true, updatedAt: true, plan: true },
  });

  let notified = 0;
  let skipped = 0;
  const REMINDER_DAYS = [1, 3, 5];

  for (const o of candidates) {
   // Per-org isolation — a failed email/audit-write on one org must not
   // abort reminders for the rest of the past_due cohort.
   try {
    const anchor = o.pastDueSince ?? o.updatedAt;
    const daysOverdue = Math.floor((now.getTime() - anchor.getTime()) / 86400000);
    // The stage they should have reached by now = the largest threshold ≤
    // daysOverdue. undefined means not yet due for the first reminder.
    const dueStage = [...REMINDER_DAYS].reverse().find((t) => daysOverdue >= t);
    if (dueStage === undefined) {
      skipped++;
      continue;
    }
    if (!o.billingEmail) {
      skipped++;
      continue;
    }
    // Per-stage dedup: have we already sent THIS stage to THIS org? (Tag stored
    // in the audit `after` JSON.) Replaces the per-day bucket so a missed day
    // is recoverable and a same-day double run still can't double-send.
    const already = await prisma.platformAuditLog.findFirst({
      where: {
        action: "owner.dunning_reminder_sent",
        orgId: o.id,
        after: { contains: `"stage":${dueStage},` },
      },
      select: { id: true },
    });
    if (already) {
      skipped++;
      continue;
    }

    const daysUntilSuspend = Math.max(0, 7 - daysOverdue);
    await sendEmail({
      to: o.billingEmail,
      subject: `Payment update required · ${o.name}`,
      html: renderEmail({
        centreName: o.name,
        heading: "Your payment didn't go through",
        body: `<p>We tried to charge your ${o.plan} subscription and the payment failed.</p>
<p>${daysUntilSuspend > 0
  ? `Your account moves to <b>read-only</b> in ${daysUntilSuspend} day${daysUntilSuspend === 1 ? "" : "s"} if billing isn't updated.`
  : "Your account moves to read-only mode today."}</p>
<p>Common fixes:</p>
<ul style="line-height:1.7">
  <li>Insufficient balance on the card / UPI</li>
  <li>Card expired</li>
  <li>Bank flagged the recurring auth — call your bank to whitelist Equiwings</li>
</ul>
<p>Update payment details in Equiwings → Settings → Billing, or contact us if you need help.</p>`,
      }),
      ref: { type: "billing.dunning_reminder", rowId: o.id, payload: { stage: dueStage, daysOverdue } },
    });
    await prisma.platformAuditLog.create({
      data: {
        actorId: null,
        action: "owner.dunning_reminder_sent",
        orgId: o.id,
        // `stage` MUST be the first key so the `"stage":N,` dedup match above is exact.
        after: JSON.stringify({ stage: dueStage, daysOverdue, daysUntilSuspend, at: now.toISOString() }),
      },
    });
    notified++;
   } catch (err) {
     console.error("[dunning] reminder failed", { orgId: o.id, err });
     skipped++;
   }
  }

  return { job: "dunning", scanned: candidates.length, notified, skipped };
}

import { prisma } from "../prisma";
import { sendEmail, renderEmail } from "../email";
import { SweepResult } from "./shared";

// Dunning: orgs in past_due state get reminder emails before the 7-day
// cutoff to suspended. We send on day 1, 3, and 5 since they were
// flagged past_due (Organisation.updatedAt is bumped when sweepTrialEnd
// or the Stripe/Razorpay webhook moves them). Dedup is per-day-bucket
// via a tag in the PlatformAuditLog so we don't double-fire on the
// same day if the cron runs twice.
export async function sweepDunning(): Promise<SweepResult> {
  const now = new Date();
  const candidates = await prisma.organisation.findMany({
    where: { status: "past_due" },
    select: { id: true, name: true, billingEmail: true, updatedAt: true, plan: true },
  });

  let notified = 0;
  let skipped = 0;
  const REMINDER_DAYS = [1, 3, 5];

  for (const o of candidates) {
    const daysOverdue = Math.floor((now.getTime() - o.updatedAt.getTime()) / 86400000);
    if (!REMINDER_DAYS.includes(daysOverdue)) {
      skipped++;
      continue;
    }
    if (!o.billingEmail) {
      skipped++;
      continue;
    }
    // Dedup — check audit table for today's reminder on this org.
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const already = await prisma.platformAuditLog.findFirst({
      where: { action: "owner.dunning_reminder_sent", orgId: o.id, at: { gte: dayStart } },
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
      ref: { type: "billing.dunning_reminder", rowId: o.id, payload: { daysOverdue } },
    });
    await prisma.platformAuditLog.create({
      data: {
        actorId: null,
        action: "owner.dunning_reminder_sent",
        orgId: o.id,
        after: JSON.stringify({ daysOverdue, daysUntilSuspend, at: now.toISOString() }),
      },
    });
    notified++;
  }

  return { job: "dunning", scanned: candidates.length, notified, skipped };
}

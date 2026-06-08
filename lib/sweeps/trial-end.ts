import { prisma } from "../prisma";
import { sendEmail, renderEmail } from "../email";
import { SweepResult } from "./shared";

// Sweep: trial-end → past_due → suspended.
// 1. Orgs whose trialEndsAt < now but status is still "trial" → move to
//    "past_due". Stripe webhooks normally do this, but a dropped/late
//    webhook leaves the tenant stuck.
// 2. Orgs that have been past_due for >7 days WITHOUT a successful payment
//    → suspend (read-only mode). Sweeps notifies the billing contact at
//    each transition so they're not surprised by a sudden lockout.
export async function sweepTrialEnd(): Promise<SweepResult> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
  const transitions: string[] = [];
  let notified = 0;
  let scanned = 0;
  let skipped = 0;

  // Every state transition lands in PlatformAuditLog so the owner-portal
  // can surface a "Tenants needing attention" feed without polling Stripe
  // or guessing from email logs.
  async function logTransition(action: "owner.tenant_past_due" | "owner.tenant_suspended", orgId: string) {
    await prisma.platformAuditLog.create({
      data: { actorId: null, action, orgId, after: JSON.stringify({ at: new Date().toISOString() }) },
    });
  }

  // Step 1: expired trials → past_due
  const expired = await prisma.organisation.findMany({
    where: { status: "trial", trialEndsAt: { lt: now } },
    select: { id: true, name: true, billingEmail: true, trialEndsAt: true },
  });
  scanned += expired.length;
  for (const o of expired) {
   // Per-org isolation — one failed update/email must not block the rest.
   try {
    await prisma.organisation.update({
      where: { id: o.id },
      // Stamp pastDueSince so dunning + the suspend countdown anchor on the
      // real transition time, immune to later unrelated updatedAt bumps.
      data: { status: "past_due", pastDueSince: now },
    });
    await logTransition("owner.tenant_past_due", o.id);
    if (o.billingEmail) {
      await sendEmail({
        to: o.billingEmail,
        subject: `Your Equiwings trial has ended — ${o.name}`,
        html: renderEmail({
          centreName: o.name,
          heading: "Trial ended",
          body: `<p>Your trial ended on ${o.trialEndsAt?.toISOString().slice(0, 10) ?? "today"}.</p>
<p>You have 7 days to enter billing details before the account moves to read-only mode. Existing data stays intact; you'll be able to view but not edit.</p>`,
        }),
        ref: { type: "billing.trial_ended", rowId: o.id },
      });
      notified++;
    } else {
      skipped++;
    }
    transitions.push(`trial→past_due: ${o.name}`);
   } catch (err) {
     console.error("[trial_end] trial→past_due failed", { orgId: o.id, err });
   }
  }

  // Step 2: past_due > 7 days → suspended. Anchor on pastDueSince (the real
  // transition time); fall back to updatedAt only for legacy rows whose
  // pastDueSince is null (pre-column / backfill gaps).
  const stalePastDue = await prisma.organisation.findMany({
    where: {
      status: "past_due",
      OR: [
        { pastDueSince: { lt: sevenDaysAgo } },
        { pastDueSince: null, updatedAt: { lt: sevenDaysAgo } },
      ],
    },
    select: { id: true, name: true, billingEmail: true },
  });
  scanned += stalePastDue.length;
  for (const o of stalePastDue) {
   // Per-org isolation — one failed suspend must not block the rest.
   try {
    await prisma.organisation.update({
      where: { id: o.id },
      // No longer past_due → clear the clock.
      data: { status: "suspended", pastDueSince: null },
    });
    await logTransition("owner.tenant_suspended", o.id);
    if (o.billingEmail) {
      await sendEmail({
        to: o.billingEmail,
        subject: `Equiwings account suspended — ${o.name}`,
        html: renderEmail({
          centreName: o.name,
          heading: "Account suspended (read-only)",
          body: `<p>No payment has been received for 7 days after the trial ended. The account is now in read-only mode — your data is safe but staff cannot make changes until billing is updated.</p>
<p>Update payment details to restore full access.</p>`,
        }),
        ref: { type: "billing.suspended", rowId: o.id },
      });
      notified++;
    } else {
      skipped++;
    }
    transitions.push(`past_due→suspended: ${o.name}`);
   } catch (err) {
     console.error("[trial_end] past_due→suspended failed", { orgId: o.id, err });
   }
  }

  return { job: "trial_end", scanned, notified, skipped, details: { transitions } };
}

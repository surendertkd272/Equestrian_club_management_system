import { prisma } from "../prisma";
import { notify } from "../notify";
import { sendSms } from "../sms";
import { sendEmail, renderEmail } from "../email";
import { sendWhatsApp } from "../whatsapp";
import { hasFeature } from "../features-gate";
import { SweepResult, centreManagerMap, recentlyNotified } from "./shared";
import { creditPosition } from "../credit-note";

// ─────────────────────────────────────────────────────────────────────────────
// Job 1: Fee-due reminders.
// Fires for invoices with dueDate within 1-4 days; once per invoice per day.
// Skips invoices belonging to orgs that have turned fee-collection off — the
// invoice rows stay in the DB for audit but reminders go silent.
export async function sweepFeeDue(): Promise<SweepResult> {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);

  const invoices = await prisma.invoice.findMany({
    where: {
      status: "due",
      dueDate: { gte: windowStart, lte: windowEnd },
      // Never chase a cancelled charge, and a credit note is not a bill.
      voidedAt: null,
      creditNoteForId: null,
      // Nor a family that has left. They may still owe money, but a dunning
      // SMS to someone who off-boarded is how disputes start; the balance
      // stays on the books for staff to settle deliberately.
      rider: { status: { not: "withdrawn" } },
    },
    include: {
      rider: { select: { firstName: true, lastName: true, mobile: true, fatherPhone: true, motherPhone: true, email: true } },
      // timezone: the due date is rendered into the parent's email, and the
      // server runs UTC — without it a date near midnight states the wrong day.
      centre: { select: { name: true, orgId: true, timezone: true } },
      payments: { select: { amount: true } },
      creditNotes: { select: { amount: true, gstAmount: true } },
    },
  });

  // Resolve fee-collection per org once for the whole batch. The set holds
  // org IDs where fees are ON; anything else gets skipped.
  const orgIds = Array.from(new Set(invoices.map((i) => i.centre.orgId).filter(Boolean) as string[]));
  const feesOnOrgs = new Set<string>();
  await Promise.all(
    orgIds.map(async (orgId) => {
      if (await hasFeature(orgId, "fee-collection")) feesOnOrgs.add(orgId);
    }),
  );

  // One centre lookup for the whole batch instead of one per invoice.
  const managers = await centreManagerMap(invoices.map((i) => i.centreId));

  let notified = 0;
  let skipped = 0;
  let failed = 0;
  for (const inv of invoices) {
   // Per-invoice isolation — a thrown DB lookup or channel send on ONE
   // invoice must not abort the remaining reminders in the batch.
   try {
    // Master fee-collection switch — silence reminders for orgs that opted out.
    if (!inv.centre.orgId || !feesOnOrgs.has(inv.centre.orgId)) {
      skipped += 1;
      continue;
    }
    // What the family actually owes: face value, less credits, less payments.
    // The old copy interpolated inv.amount, which is the pre-GST, pre-credit
    // column — so a family credited ₹20,000 of a ₹23,600 bill was texted
    // "₹20,000 is due" when they owed ₹3,600, and an uncredited bill was
    // under-quoted by its GST.
    const owed = creditPosition(inv).outstanding;
    if (owed <= 0.001) {
      skipped += 1;
      continue;
    }
    const owedText = Math.round(owed).toLocaleString("en-IN");

    const mgrId = managers.get(inv.centreId) ?? null;
    if (!mgrId) {
      skipped += 1;
      continue;
    }
    if (await recentlyNotified(mgrId, "invoice.due_soon", inv.id, 23 * 60 * 60 * 1000)) {
      skipped += 1;
      continue;
    }
    const days = Math.ceil((inv.dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    const parentPhone = inv.rider.fatherPhone ?? inv.rider.motherPhone ?? inv.rider.mobile;
    await notify({
      userId: mgrId,
      centreId: inv.centreId,
      type: "invoice.due_soon",
      title: `Fee due in ${days}d · ${inv.rider.firstName} ${inv.rider.lastName}`,
      body: `₹${owedText} · ${inv.kind.replace("_", " ")} · contact parent at ${parentPhone}`,
      link: `/riders/${inv.riderId}`,
      payload: { invoiceId: inv.id, riderId: inv.riderId, days },
    });
    // Parent SMS — non-blocking; never throws.
    await sendSms({
      to: parentPhone,
      body: `Equiwings: ₹${owedText} fee for ${inv.rider.firstName} is due in ${days} day${days === 1 ? "" : "s"}. Pay via the link sent earlier or visit the centre.`,
      ref: { type: "invoice.due_soon", rowId: inv.id, payload: { riderId: inv.riderId } },
    });
    // Parent WhatsApp — uses pre-approved template `ew_invoice_due_soon`.
    await sendWhatsApp({
      to: parentPhone,
      centreId: inv.centreId,
      template: {
        name: "ew_invoice_due_soon",
        bodyParams: [
          `${inv.rider.firstName} ${inv.rider.lastName}`,
          String(days),
          `₹${owedText}`,
        ],
      },
      previewBody: `Fee reminder for ${inv.rider.firstName}: ₹${owedText} due in ${days}d`,
      ref: { type: "invoice.due_soon", rowId: inv.id, payload: { riderId: inv.riderId } },
    });
    // Parent email — richer than SMS, includes the breakdown.
    if (inv.rider.email) {
      await sendEmail({
        to: inv.rider.email,
        subject: `Fee due in ${days} day${days === 1 ? "" : "s"} · ${inv.rider.firstName} ${inv.rider.lastName}`,
        html: renderEmail({
          centreName: inv.centre.name,
          heading: `Fee reminder · ₹${owedText}`,
          body: `<p>Dear Parent / Guardian,</p>
<p>The <b>${inv.kind.replace("_", " ")}</b> fee for <b>${inv.rider.firstName} ${inv.rider.lastName}</b> is due on <b>${inv.dueDate.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric", timeZone: inv.centre.timezone })}</b> (in ${days} day${days === 1 ? "" : "s"}).</p>
<table style="margin:16px 0;border-collapse:collapse;">
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Amount</td><td style="padding:4px 0;font-weight:600;">₹${owedText}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Kind</td><td style="padding:4px 0;">${inv.kind.replace("_", " ")}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Reference</td><td style="padding:4px 0;font-family:monospace;font-size:12px;">${inv.id.slice(-8)}</td></tr>
</table>
<p>Please pay before the due date to avoid suspension.</p>`,
        }),
        ref: { type: "invoice.due_soon", rowId: inv.id, payload: { riderId: inv.riderId } },
      });
    }
    notified += 1;
   } catch (err) {
     console.error("[fee_due] reminder failed", { invoiceId: inv.id, err });
     failed += 1;
   }
  }

  return { job: "fee_due", scanned: invoices.length, notified, skipped, details: { failed } };
}

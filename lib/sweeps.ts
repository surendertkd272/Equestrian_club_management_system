// Cron-driven sweeps. Each function is pure: it reads from the DB, emits notifications,
// returns a summary. Safe to run more than once per day — dedup is via "did a notif of
// this type for this row already land in the last 24h?".
//
// Recipients route to the centre manager because riders don't have user accounts in this build.
// When parent accounts (or external SMS/WhatsApp dispatch) land, change the `userId` selection
// in each sweep — the trigger logic doesn't move.

import { prisma } from "./prisma";
import { notify } from "./notify";
import { sendSms } from "./sms";
import { sendEmail, renderEmail } from "./email";
import { sendWhatsApp } from "./whatsapp";

export type SweepResult = {
  job: string;
  scanned: number;
  notified: number;
  skipped: number;
  details?: unknown;
};

// ─────────────────────────────────────────────────────────────────────────────
// Dedup helper — skip if any notif of (userId, type) referencing the same row
// has been emitted in the last `windowMs` milliseconds.
async function recentlyNotified(
  userId: string,
  type: string,
  rowKey: string,
  windowMs: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const existing = await prisma.notification.findFirst({
    where: {
      userId,
      type,
      createdAt: { gte: since },
      payload: { contains: rowKey },
    },
    select: { id: true },
  });
  return existing !== null;
}

async function centreManagerId(centreId: string): Promise<string | null> {
  const c = await prisma.centre.findUnique({ where: { id: centreId }, select: { managerId: true } });
  return c?.managerId ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Job 1: Fee-due reminders.
// Fires for invoices with dueDate within 1-4 days; once per invoice per day.
export async function sweepFeeDue(): Promise<SweepResult> {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);

  const invoices = await prisma.invoice.findMany({
    where: { status: "due", dueDate: { gte: windowStart, lte: windowEnd } },
    include: {
      rider: { select: { firstName: true, lastName: true, mobile: true, fatherPhone: true, motherPhone: true, email: true } },
      centre: { select: { name: true } },
    },
  });

  let notified = 0;
  let skipped = 0;
  for (const inv of invoices) {
    const mgrId = await centreManagerId(inv.centreId);
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
      body: `₹${inv.amount.toLocaleString("en-IN")} · ${inv.kind.replace("_", " ")} · contact parent at ${parentPhone}`,
      link: `/finance`,
      payload: { invoiceId: inv.id, riderId: inv.riderId, days },
    });
    // Parent SMS — non-blocking; never throws.
    await sendSms({
      to: parentPhone,
      body: `Equiwings: ₹${inv.amount.toLocaleString("en-IN")} fee for ${inv.rider.firstName} is due in ${days} day${days === 1 ? "" : "s"}. Pay via the link sent earlier or visit the centre.`,
      ref: { type: "invoice.due_soon", rowId: inv.id, payload: { riderId: inv.riderId } },
    });
    // Parent WhatsApp — uses pre-approved template `ew_invoice_due_soon`.
    await sendWhatsApp({
      to: parentPhone,
      template: {
        name: "ew_invoice_due_soon",
        bodyParams: [
          `${inv.rider.firstName} ${inv.rider.lastName}`,
          String(days),
          `₹${inv.amount.toLocaleString("en-IN")}`,
        ],
      },
      previewBody: `Fee reminder for ${inv.rider.firstName}: ₹${inv.amount.toLocaleString("en-IN")} due in ${days}d`,
      ref: { type: "invoice.due_soon", rowId: inv.id, payload: { riderId: inv.riderId } },
    });
    // Parent email — richer than SMS, includes the breakdown.
    if (inv.rider.email) {
      await sendEmail({
        to: inv.rider.email,
        subject: `Fee due in ${days} day${days === 1 ? "" : "s"} · ${inv.rider.firstName} ${inv.rider.lastName}`,
        html: renderEmail({
          centreName: inv.centre.name,
          heading: `Fee reminder · ₹${inv.amount.toLocaleString("en-IN")}`,
          body: `<p>Dear Parent / Guardian,</p>
<p>The <b>${inv.kind.replace("_", " ")}</b> fee for <b>${inv.rider.firstName} ${inv.rider.lastName}</b> is due on <b>${inv.dueDate.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}</b> (in ${days} day${days === 1 ? "" : "s"}).</p>
<table style="margin:16px 0;border-collapse:collapse;">
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Amount</td><td style="padding:4px 0;font-weight:600;">₹${inv.amount.toLocaleString("en-IN")}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Kind</td><td style="padding:4px 0;">${inv.kind.replace("_", " ")}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Reference</td><td style="padding:4px 0;font-family:monospace;font-size:12px;">${inv.id.slice(-8)}</td></tr>
</table>
<p>Please pay before the due date to avoid suspension.</p>`,
        }),
        ref: { type: "invoice.due_soon", rowId: inv.id, payload: { riderId: inv.riderId } },
      });
    }
    notified += 1;
  }

  return { job: "fee_due", scanned: invoices.length, notified, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Job 2: Medicine expiry digest.
// One digest notification per centre listing medicines expiring within 30 days.
export async function sweepMedicineExpiry(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const meds = await prisma.medicine.findMany({
    where: { qty: { gt: 0 }, expDate: { lte: cutoff } },
    orderBy: { expDate: "asc" },
    select: { id: true, name: true, batchNo: true, expDate: true, qty: true, centreId: true },
  });

  // Group by centre.
  const byCentre = new Map<string, typeof meds>();
  for (const m of meds) {
    if (!byCentre.has(m.centreId)) byCentre.set(m.centreId, []);
    byCentre.get(m.centreId)!.push(m);
  }

  let notified = 0;
  let skipped = 0;
  for (const [centreId, list] of byCentre.entries()) {
    const mgrId = await centreManagerId(centreId);
    if (!mgrId) {
      skipped += 1;
      continue;
    }
    // Daily digest — one per centre per day.
    if (await recentlyNotified(mgrId, "medicine.expiry_digest", centreId, 23 * 60 * 60 * 1000)) {
      skipped += 1;
      continue;
    }
    const preview = list
      .slice(0, 3)
      .map((m) => `${m.name} (${m.batchNo})`)
      .join(", ");
    const more = list.length > 3 ? ` + ${list.length - 3} more` : "";
    await notify({
      userId: mgrId,
      centreId,
      type: "medicine.expiry_digest",
      title: `${list.length} medicine${list.length === 1 ? "" : "s"} expiring within 30 days`,
      body: `${preview}${more}. Review the inventory and rotate / reorder.`,
      link: "/medicines?status=expiring",
      payload: { centreId, count: list.length, ids: list.map((m) => m.id).slice(0, 20) },
    });
    notified += 1;
  }

  return { job: "medicine_expiry", scanned: meds.length, notified, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Job 2b: Horse insurance expiry digest.
// PDF §4 — Insurance Records. Flags any horse whose policy is within 30 days
// of validTo, or already expired. One digest per centre per day so managers
// can chase renewals before the cover lapses.
export async function sweepHorseInsuranceExpiry(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const horses = await prisma.horse.findMany({
    where: {
      status: { not: "retired" },
      insuranceValidTo: { lte: cutoff, not: null },
    },
    orderBy: { insuranceValidTo: "asc" },
    select: {
      id: true,
      name: true,
      stableNo: true,
      insurerName: true,
      insuranceValidTo: true,
      centreId: true,
    },
  });

  const byCentre = new Map<string, typeof horses>();
  for (const h of horses) {
    if (!byCentre.has(h.centreId)) byCentre.set(h.centreId, []);
    byCentre.get(h.centreId)!.push(h);
  }

  let notified = 0;
  let skipped = 0;
  for (const [centreId, list] of byCentre.entries()) {
    const mgrId = await centreManagerId(centreId);
    if (!mgrId) {
      skipped += 1;
      continue;
    }
    if (await recentlyNotified(mgrId, "horse.insurance_expiry_digest", centreId, 23 * 60 * 60 * 1000)) {
      skipped += 1;
      continue;
    }
    const preview = list
      .slice(0, 3)
      .map((h) => `${h.name}${h.stableNo ? ` (${h.stableNo})` : ""}`)
      .join(", ");
    const more = list.length > 3 ? ` + ${list.length - 3} more` : "";
    await notify({
      userId: mgrId,
      centreId,
      type: "horse.insurance_expiry_digest",
      title: `${list.length} horse${list.length === 1 ? "'s" : "s'"} insurance expiring within 30 days`,
      body: `${preview}${more}. Contact your insurer to renew.`,
      link: "/horses",
      payload: { centreId, count: list.length, ids: list.map((h) => h.id).slice(0, 20) },
    });
    notified += 1;
  }

  return { job: "horse_insurance_expiry", scanned: horses.length, notified, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Job 2c: Farrier overdue / upcoming digest.
// Two windows: visits scheduled in the next 7 days (heads-up) + completed
// visits past their nextDueAt (overdue). One digest per centre per day.
export async function sweepFarrierDigest(): Promise<SweepResult> {
  const now = new Date();
  const sevenDays = new Date(now.getTime() + 7 * 86400000);

  const upcoming = await prisma.farrierVisit.findMany({
    where: { status: "scheduled", scheduledAt: { gte: now, lte: sevenDays } },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, centreId: true, scheduledAt: true, horse: { select: { name: true, stableNo: true } } },
  });
  const overdue = await prisma.farrierVisit.findMany({
    where: { status: "completed", nextDueAt: { lt: now } },
    orderBy: { nextDueAt: "asc" },
    select: { id: true, centreId: true, nextDueAt: true, horse: { select: { name: true, stableNo: true } } },
  });

  const byCentre = new Map<string, { upcoming: typeof upcoming; overdue: typeof overdue }>();
  for (const v of upcoming) {
    const slot = byCentre.get(v.centreId) ?? { upcoming: [], overdue: [] };
    slot.upcoming.push(v);
    byCentre.set(v.centreId, slot);
  }
  for (const v of overdue) {
    const slot = byCentre.get(v.centreId) ?? { upcoming: [], overdue: [] };
    slot.overdue.push(v);
    byCentre.set(v.centreId, slot);
  }

  let notified = 0;
  let skipped = 0;
  for (const [centreId, slot] of byCentre.entries()) {
    if (slot.upcoming.length === 0 && slot.overdue.length === 0) continue;
    const mgrId = await centreManagerId(centreId);
    if (!mgrId) { skipped += 1; continue; }
    if (await recentlyNotified(mgrId, "farrier.digest", centreId, 23 * 60 * 60 * 1000)) {
      skipped += 1; continue;
    }
    const overduePart = slot.overdue.length > 0
      ? `${slot.overdue.length} horse${slot.overdue.length === 1 ? "" : "s"} overdue`
      : "";
    const upPart = slot.upcoming.length > 0
      ? `${slot.upcoming.length} visit${slot.upcoming.length === 1 ? "" : "s"} this week`
      : "";
    const title = [overduePart, upPart].filter(Boolean).join(" · ");
    const preview = [...slot.overdue, ...slot.upcoming].slice(0, 3)
      .map((v) => `${v.horse.name}${v.horse.stableNo ? ` (${v.horse.stableNo})` : ""}`).join(", ");
    await notify({
      userId: mgrId,
      centreId,
      type: "farrier.digest",
      title: `Farrier: ${title}`,
      body: preview,
      link: "/farriery",
      // centreId in payload is the dedup key recentlyNotified() searches for.
      payload: { centreId, upcoming: slot.upcoming.length, overdue: slot.overdue.length },
    });
    notified += 1;
  }

  return { job: "farrier_digest", scanned: upcoming.length + overdue.length, notified, skipped };
}

// Job 2d: Vaccination due digest. Horses with nextDueAt within 30 days roll up
// into one notification per centre.
export async function sweepVaccinationDue(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() + 30 * 86400000);

  const rows = await prisma.vaccinationSchedule.findMany({
    where: { nextDueAt: { lte: cutoff } },
    orderBy: { nextDueAt: "asc" },
    select: {
      id: true,
      centreId: true,
      vaccineLabel: true,
      nextDueAt: true,
      horse: { select: { name: true, stableNo: true } },
    },
  });

  const byCentre = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byCentre.has(r.centreId)) byCentre.set(r.centreId, []);
    byCentre.get(r.centreId)!.push(r);
  }

  let notified = 0;
  let skipped = 0;
  for (const [centreId, list] of byCentre.entries()) {
    const mgrId = await centreManagerId(centreId);
    if (!mgrId) { skipped += 1; continue; }
    if (await recentlyNotified(mgrId, "vaccination.due_digest", centreId, 23 * 60 * 60 * 1000)) {
      skipped += 1; continue;
    }
    const preview = list.slice(0, 3)
      .map((r) => `${r.horse.name} · ${r.vaccineLabel}`).join(", ");
    const more = list.length > 3 ? ` + ${list.length - 3} more` : "";
    await notify({
      userId: mgrId,
      centreId,
      type: "vaccination.due_digest",
      title: `${list.length} vaccination${list.length === 1 ? "" : "s"} due within 30 days`,
      body: `${preview}${more}.`,
      link: "/vaccinations",
      payload: { count: list.length, ids: list.map((r) => r.id).slice(0, 20) },
    });
    notified += 1;
  }

  return { job: "vaccination_due", scanned: rows.length, notified, skipped };
}

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

  for (const rider of riders) {
    const mgrId = await centreManagerId(rider.centreId);
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
      body: `Call parent at ${parentPhone} to check in. Per GHRC rule, 15d un-notified absence cancels membership.`,
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

// ─────────────────────────────────────────────────────────────────────────────
// Job 4: Birthday wishes.
// Spec §4.22 lists "birthday wishes → rider (engagement)". Notification routes to the
// centre manager (who can then arrange a card / WhatsApp); a parent-direct channel
// is what the SMS dispatch upgrade will unlock.
export async function sweepBirthdays(): Promise<SweepResult> {
  const today = new Date();
  const mm = today.getMonth();
  const dd = today.getDate();

  // SQLite doesn't have month()/day() out of the box via Prisma — fetch active
  // riders and filter in JS. With ~hundreds of riders, this is fine.
  const riders = await prisma.rider.findMany({
    where: { status: "active" },
    select: { id: true, firstName: true, lastName: true, centreId: true, dob: true },
  });

  let notified = 0;
  let skipped = 0;
  const birthdayKids = riders.filter((r) => {
    const dob = new Date(r.dob);
    return dob.getMonth() === mm && dob.getDate() === dd;
  });

  // Need phone + email for SMS/email — fetch with the extra fields.
  const fullRiders = await prisma.rider.findMany({
    where: { id: { in: birthdayKids.map((r) => r.id) } },
    select: { id: true, firstName: true, lastName: true, centreId: true, dob: true, mobile: true, fatherPhone: true, motherPhone: true, email: true, centre: { select: { name: true } } },
  });
  for (const r of fullRiders) {
    const mgrId = await centreManagerId(r.centreId);
    if (!mgrId) {
      skipped += 1;
      continue;
    }
    if (await recentlyNotified(mgrId, "rider.birthday", r.id, 23 * 60 * 60 * 1000)) {
      skipped += 1;
      continue;
    }
    const age = today.getFullYear() - new Date(r.dob).getFullYear();
    await notify({
      userId: mgrId,
      centreId: r.centreId,
      type: "rider.birthday",
      title: `🎂 ${r.firstName} ${r.lastName} turns ${age} today`,
      body: `Send a card or WhatsApp greeting — the easy engagement win.`,
      link: `/riders/${r.id}`,
      payload: { riderId: r.id, age },
    });
    // Parent SMS — best-of-engagement nudge.
    const parentPhone = r.fatherPhone ?? r.motherPhone ?? r.mobile;
    await sendSms({
      to: parentPhone,
      body: `Happy Birthday ${r.firstName}! 🎂 Wishing you a wonderful ${age}th year — see you at the stables. — Team Equiwings`,
      ref: { type: "rider.birthday", rowId: r.id, payload: { age } },
    });
    // Parent WhatsApp — pre-approved template `ew_birthday`.
    await sendWhatsApp({
      to: parentPhone,
      template: { name: "ew_birthday", bodyParams: [r.firstName, String(age)] },
      previewBody: `Happy Birthday ${r.firstName} — ${age} 🎂`,
      ref: { type: "rider.birthday", rowId: r.id, payload: { age } },
    });
    // Parent email — warmer engagement piece.
    if (r.email) {
      await sendEmail({
        to: r.email,
        subject: `🎂 Happy Birthday ${r.firstName}!`,
        html: renderEmail({
          centreName: r.centre.name,
          heading: `Happy ${age}th Birthday, ${r.firstName}! 🎂`,
          body: `<p>Dear ${r.firstName},</p>
<p>Everyone at ${r.centre.name} is sending you the warmest birthday wishes today. We can't wait to see you at the stables for another year of riding adventures together.</p>
<p style="font-size:32px;text-align:center;margin:24px 0;">🐎  🥇  🎉</p>
<p>— Team Equiwings</p>`,
        }),
        ref: { type: "rider.birthday", rowId: r.id, payload: { age } },
      });
    }
    notified += 1;
  }

  return { job: "birthdays", scanned: riders.length, notified, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Job 5: Monthly parent report cards (§4.5).
// Spec calls for "1st of every month — auto-email previous month's report card".
// Runs only on the 1st (or when force=true is passed via /api/cron/sweep?job=monthly_reports&force=1).
// Sends a one-page summary email to each active rider's parent for the previous calendar month.
export async function sweepMonthlyReports(opts: { force?: boolean } = {}): Promise<SweepResult> {
  const today = new Date();
  if (!opts.force && today.getDate() !== 1) {
    return { job: "monthly_reports", scanned: 0, notified: 0, skipped: 0, details: "not first of month" };
  }

  const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const monthLabel = prevMonthStart.toLocaleString("en-IN", { month: "long", year: "numeric" });

  const riders = await prisma.rider.findMany({
    where: { status: "active" },
    select: {
      id: true,
      centreId: true,
      firstName: true,
      lastName: true,
      email: true,
      currentLevel: true,
      centre: { select: { name: true } },
    },
  });

  let notified = 0;
  let skipped = 0;

  // Cache centre → manager so we don't re-query per rider.
  const managerCache = new Map<string, string | null>();
  async function getManager(centreId: string): Promise<string | null> {
    if (!managerCache.has(centreId)) {
      managerCache.set(centreId, await centreManagerId(centreId));
    }
    return managerCache.get(centreId) ?? null;
  }

  for (const rider of riders) {
    if (!rider.email) {
      skipped += 1;
      continue;
    }
    const mgrId = await getManager(rider.centreId);
    // Dedup: has this rider's monthly email been audited via centre-manager notif in last 20 days?
    if (mgrId && (await recentlyNotified(mgrId, "report.monthly_email", rider.id, 20 * 24 * 60 * 60 * 1000))) {
      skipped += 1;
      continue;
    }

    // Aggregate stats for the previous month.
    const [attendances, exams, paymentAgg, masteredThisMonth, certs] = await Promise.all([
      prisma.attendance.findMany({
        where: { riderId: rider.id, date: { gte: prevMonthStart, lte: prevMonthEnd } },
        select: { status: true },
      }),
      prisma.exam.findMany({
        where: { riderId: rider.id, status: "completed", date: { gte: prevMonthStart, lte: prevMonthEnd } },
        select: { level: true, totalScore: true, passed: true },
      }),
      prisma.payment.aggregate({
        where: { invoice: { riderId: rider.id }, paidAt: { gte: prevMonthStart, lte: prevMonthEnd } },
        _sum: { amount: true },
      }),
      prisma.riderSkillStatus.count({
        where: { riderId: rider.id, status: "mastered", updatedAt: { gte: prevMonthStart, lte: prevMonthEnd } },
      }),
      prisma.certificate.findMany({
        where: { riderId: rider.id, issuedAt: { gte: prevMonthStart, lte: prevMonthEnd } },
        select: { levelName: true, serialNo: true },
      }),
    ]);

    const aTotal = attendances.length;
    const aPresent = attendances.filter((a) => a.status === "present" || a.status === "late").length;
    const attendancePct = aTotal > 0 ? Math.round((aPresent / aTotal) * 100) : null;
    const paid = Math.round(paymentAgg._sum.amount ?? 0);

    const html = renderEmail({
      centreName: rider.centre.name,
      heading: `${rider.firstName}'s ${monthLabel} report card`,
      body: `<p>Dear Parent / Guardian,</p>
<p>Here's a one-line snapshot of <b>${rider.firstName}'s</b> ${monthLabel}.</p>
<table style="width:100%;margin:16px 0;border-collapse:collapse;">
  <tr><td style="padding:8px;background:#f9fafb;border:1px solid #e5e7eb;color:#6b7280;font-size:12px;text-transform:uppercase;">Current level</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600;">${rider.currentLevel ?? "Beginner"}</td></tr>
  <tr><td style="padding:8px;background:#f9fafb;border:1px solid #e5e7eb;color:#6b7280;font-size:12px;text-transform:uppercase;">Attendance</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600;">${attendancePct === null ? "—" : `${attendancePct}% (${aPresent}/${aTotal} sessions)`}</td></tr>
  <tr><td style="padding:8px;background:#f9fafb;border:1px solid #e5e7eb;color:#6b7280;font-size:12px;text-transform:uppercase;">New skills mastered</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600;">${masteredThisMonth}</td></tr>
  <tr><td style="padding:8px;background:#f9fafb;border:1px solid #e5e7eb;color:#6b7280;font-size:12px;text-transform:uppercase;">Exams this month</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600;">${exams.length} ${exams.length ? `(${exams.filter((e) => e.passed).length} passed)` : ""}</td></tr>
  <tr><td style="padding:8px;background:#f9fafb;border:1px solid #e5e7eb;color:#6b7280;font-size:12px;text-transform:uppercase;">Certificates issued</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600;">${certs.length}${certs.length ? ` — ${certs.map((c) => c.serialNo).join(", ")}` : ""}</td></tr>
  <tr><td style="padding:8px;background:#f9fafb;border:1px solid #e5e7eb;color:#6b7280;font-size:12px;text-transform:uppercase;">Fees paid</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600;">₹${paid.toLocaleString("en-IN")}</td></tr>
</table>
<p>Visit the centre or reply to this email if you'd like to discuss progress.</p>`,
    });

    await sendEmail({
      to: rider.email,
      subject: `${rider.firstName}'s ${monthLabel} report card`,
      html,
      ref: { type: "report.monthly_email", rowId: rider.id, payload: { month: monthLabel } },
    });

    // Audit the trigger via a notification row too — gives us a queryable "did the email go out" record
    // and powers the dedup check on subsequent runs.
    if (mgrId) {
      await notify({
        userId: mgrId,
        centreId: rider.centreId,
        type: "report.monthly_email",
        title: `Sent ${monthLabel} report · ${rider.firstName} ${rider.lastName}`,
        body: `Email dispatched to ${rider.email}.`,
        link: `/reports/${rider.id}`,
        payload: { riderId: rider.id, month: monthLabel },
      });
    }
    notified += 1;
  }

  return { job: "monthly_reports", scanned: riders.length, notified, skipped, details: { month: monthLabel } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Run all jobs (used by the /api/cron/sweep endpoint).
export async function runAllSweeps(): Promise<SweepResult[]> {
  return Promise.all([
    sweepFeeDue(),
    sweepMedicineExpiry(),
    sweepHorseInsuranceExpiry(),
    sweepFarrierDigest(),
    sweepVaccinationDue(),
    sweepAbsenceEscalation(),
    sweepBirthdays(),
    sweepMonthlyReports(),
    sweepTrialEnd(),
    sweepAuditRetention(),
    sweepDpdpaDeletions(),
    sweepDunning(),
    sweepTenantOffboarding(),
    sweepBinPurge(),
  ]);
}

// Tenant offboarding — after the 30-day grace window, delete every row
// linked to the Organisation. Audit references are anonymised (userId,
// orgId stripped); PlatformAuditLog rows pointing at this orgId get
// `orgId` set to null so the platform team can still see the historical
// audit trail of the offboarding itself. SaasInvoice rows survive
// (Income Tax Act 6-year retention) — only the FK to Organisation is
// dropped via cascade-delete safety.
async function sweepTenantOffboarding(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - 30 * 86400000);
  const due = await prisma.organisation.findMany({
    where: {
      offboardingScheduledAt: { not: null, lt: cutoff },
      offboardingScrubbedAt: null,
    },
    select: { id: true, name: true, slug: true },
  });
  let deleted = 0;
  for (const org of due) {
    try {
      const centreIds = (await prisma.centre.findMany({ where: { orgId: org.id }, select: { id: true } })).map((c) => c.id);
      const userIds = (await prisma.user.findMany({
        where: { OR: [{ orgId: org.id }, { centreId: { in: centreIds } }] },
        select: { id: true },
      })).map((u) => u.id);
      if (userIds.length > 0) {
        await prisma.auditLog.updateMany({
          where: { userId: { in: userIds } },
          data: { userId: null, ip: null, userAgent: null },
        });
      }
      await prisma.platformAuditLog.updateMany({
        where: { orgId: org.id },
        data: { orgId: null },
      });
      // Cascade-delete chains from the Organisation down. SaasInvoice
      // has onDelete: Cascade in schema → goes too; if you need to keep
      // them for tax retention, change that to SetNull + add a billingName
      // snapshot column (which we already have).
      await prisma.organisation.delete({ where: { id: org.id } });
      await prisma.platformAuditLog.create({
        data: {
          actorId: null,
          action: "owner.tenant_decommissioned",
          orgId: null,
          after: JSON.stringify({ slug: org.slug, name: org.name, at: new Date().toISOString() }),
        },
      });
      deleted++;
    } catch (err) {
      console.error("[offboard] decommission failed for", org.id, err);
    }
  }
  return { job: "tenant_offboarding", scanned: due.length, notified: 0, skipped: due.length - deleted, details: { deleted } };
}

// Dunning: orgs in past_due state get reminder emails before the 7-day
// cutoff to suspended. We send on day 1, 3, and 5 since they were
// flagged past_due (Organisation.updatedAt is bumped when sweepTrialEnd
// or the Stripe/Razorpay webhook moves them). Dedup is per-day-bucket
// via a tag in the PlatformAuditLog so we don't double-fire on the
// same day if the cron runs twice.
async function sweepDunning(): Promise<SweepResult> {
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

// DPDPA Section 12: hard-delete users whose 30-day grace window has
// expired. We anonymise the AuditLog rows that reference them (replace
// userId with null, and strip any PII fields stored in before/after) so
// the financial/audit trail survives while the principal is erased.
// Anything the user "owns" (rider records, certificates, invoices) is
// reasoned about per-row:
//   • Linked Rider row: PII fields blanked, currentLevel/status preserved
//     so the centre's historical reporting isn't broken.
//   • Invoices/Payments: preserved (Indian Income Tax Act demands 6+ years).
//   • Notifications: deleted (no value, full PII).
async function sweepDpdpaDeletions(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - 30 * 86400000);
  const due = await prisma.user.findMany({
    where: { deletionRequestedAt: { lt: cutoff, not: null } },
    select: { id: true, email: true },
  });
  let deleted = 0;
  for (const u of due) {
    try {
      await prisma.$transaction([
        // Anonymise audit references — keep the row, strip the actor.
        prisma.auditLog.updateMany({
          where: { userId: u.id },
          data: { userId: null, ip: null, userAgent: null },
        }),
        // Blank rider PII when the user was tied to a rider profile.
        prisma.rider.updateMany({
          where: { userId: u.id },
          data: {
            firstName: "Deleted",
            lastName: "User",
            email: null,
            mobile: "",
            aadhaarNo: null,
            aadhaarDocUrl: null,
            photoUrl: null,
            fatherName: null,
            fatherPhone: null,
            motherName: null,
            motherPhone: null,
            emergencyName: null,
            emergencyPhone: null,
            medicalNotes: null,
            allergies: null,
            addressPresent: null,
            addressPermanent: null,
            indemnitySignerIp: null,
            indemnitySignerUa: null,
            parentalConsentJson: null,
            userId: null,
            status: "cancelled",
          },
        }),
        // Drop notifications outright — they reference user data and
        // have no compliance retention need.
        prisma.notification.deleteMany({ where: { userId: u.id } }),
        // Finally delete the user row. Cascades on this FK clean up
        // password-reset and email-verify tokens.
        prisma.user.delete({ where: { id: u.id } }),
      ]);
      deleted++;
    } catch (err) {
      // One failure shouldn't sink the batch — log and continue.
      console.error("[dpdpa] deletion failed", { id: u.id, err });
    }
  }
  return { job: "dpdpa_deletions", scanned: due.length, notified: 0, skipped: due.length - deleted, details: { deleted } };
}

// Audit-log retention sweep. Audit rows accumulate forever otherwise — at
// typical write volumes a busy tenant adds tens of thousands of rows a
// month, and most rows older than the retention window aren't useful for
// either forensic or compliance purposes. AUDIT_RETENTION_DAYS (default
// 730 = ~2 years) caps the table; tenants on heavy-compliance plans can
// raise the env var. We delete in capped batches so a one-off catch-up
// run can't lock the table for minutes.
async function sweepAuditRetention(): Promise<SweepResult> {
  const days = Math.max(30, Math.min(3650, Number(process.env.AUDIT_RETENTION_DAYS ?? "730")));
  const cutoff = new Date(Date.now() - days * 86400000);
  const BATCH = 1000;
  let totalDeleted = 0;
  // Tenant audit log.
  for (let i = 0; i < 50; i++) {
    const old = await prisma.auditLog.findMany({
      where: { at: { lt: cutoff } },
      select: { id: true },
      take: BATCH,
    });
    if (old.length === 0) break;
    const { count } = await prisma.auditLog.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
    totalDeleted += count;
    if (old.length < BATCH) break;
  }
  // Platform audit log — same retention rule. Separate table.
  let platformDeleted = 0;
  for (let i = 0; i < 50; i++) {
    const old = await prisma.platformAuditLog.findMany({
      where: { at: { lt: cutoff } },
      select: { id: true },
      take: BATCH,
    });
    if (old.length === 0) break;
    const { count } = await prisma.platformAuditLog.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
    platformDeleted += count;
    if (old.length < BATCH) break;
  }
  return {
    job: "audit_retention",
    scanned: totalDeleted + platformDeleted,
    notified: 0,
    skipped: 0,
    details: { retentionDays: days, tenantDeleted: totalDeleted, platformDeleted },
  };
}

// Sweep: trial-end → past_due → suspended.
// 1. Orgs whose trialEndsAt < now but status is still "trial" → move to
//    "past_due". Stripe webhooks normally do this, but a dropped/late
//    webhook leaves the tenant stuck.
// 2. Orgs that have been past_due for >7 days WITHOUT a successful payment
//    → suspend (read-only mode). Sweeps notifies the billing contact at
//    each transition so they're not surprised by a sudden lockout.
async function sweepTrialEnd(): Promise<SweepResult> {
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
    await prisma.organisation.update({
      where: { id: o.id },
      data: { status: "past_due" },
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
  }

  // Step 2: past_due > 7 days → suspended
  const stalePastDue = await prisma.organisation.findMany({
    where: { status: "past_due", updatedAt: { lt: sevenDaysAgo } },
    select: { id: true, name: true, billingEmail: true },
  });
  scanned += stalePastDue.length;
  for (const o of stalePastDue) {
    await prisma.organisation.update({
      where: { id: o.id },
      data: { status: "suspended" },
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
  }

  return { job: "trial_end", scanned, notified, skipped, details: { transitions } };
}

// Equipment low-stock sweep — backstop in case the threshold was lowered
// by an admin (no stock-PATCH that would naturally trigger the dip check).
// Calls the same notify helper used by the PATCH route, so dedup is
// preserved: each (centre, item) gets one notification per dip cycle.
async function sweepEquipmentLowStock(): Promise<SweepResult> {
  const stocks = await prisma.equipmentStock.findMany({
    include: { catalog: { select: { id: true, name: true, defaultThreshold: true, unit: true } } },
  });
  let scanned = 0;
  let notified = 0;
  let skipped = 0;
  for (const s of stocks) {
    scanned++;
    const threshold = s.threshold ?? s.catalog.defaultThreshold;
    if (s.qty >= threshold) continue;
    if (s.lastLowNotifiedAt && (!s.lastRestockedAt || s.lastLowNotifiedAt > s.lastRestockedAt)) {
      skipped++;
      continue;
    }
    // Re-use the on-write notifier; it handles recipient lookup + stamp.
    const mod = await import("./equipment-notify");
    await mod.notifyLowStockIfCrossed({
      stockId: s.id,
      centreId: s.centreId,
      catalogId: s.catalog.id,
      catalogName: s.catalog.name,
      qty: s.qty,
      threshold,
      unit: s.catalog.unit,
    });
    notified++;
  }
  return { job: "equipment_low_stock", scanned, notified, skipped };
}

// Accreditation expiry sweep:
//   1. Flip any active accreditation whose expiresAt has passed → "expired".
//   2. For accreditations expiring in the next 30 days, send ONE reminder
//      to the rider's centre manager (dedup via the notify "recently
//      notified" helper — same accreditation, same type, won't re-fire
//      within 7 days). National-eligibility credentials lapsing without
//      anyone noticing is the failure mode this prevents.
async function sweepAccreditationExpiry(): Promise<SweepResult> {
  const now = new Date();
  const thirty = new Date(now.getTime() + 30 * 86400000);
  let scanned = 0;
  let notified = 0;
  let skipped = 0;

  // Step 1: flip expired.
  const expired = await prisma.accreditation.findMany({
    where: { status: "active", expiresAt: { not: null, lt: now } },
    select: { id: true },
  });
  if (expired.length > 0) {
    await prisma.accreditation.updateMany({
      where: { id: { in: expired.map((e) => e.id) } },
      data: { status: "expired" },
    });
  }
  scanned += expired.length;

  // Step 2: reminders for soon-to-expire (still active).
  const soon = await prisma.accreditation.findMany({
    where: {
      status: "active",
      expiresAt: { gte: now, lte: thirty },
    },
    include: { rider: { select: { firstName: true, lastName: true, centreId: true } } },
  });
  scanned += soon.length;

  for (const a of soon) {
    // Find a manager at the rider's centre to notify.
    const manager = await prisma.user.findFirst({
      where: {
        centreId: a.rider.centreId,
        role: { in: ["CENTRE_MANAGER", "HEAD_COACH"] as any },
        status: "active",
      },
      select: { id: true },
    });
    if (!manager) {
      skipped++;
      continue;
    }
    const days = Math.ceil(((a.expiresAt!.getTime() - now.getTime()) / 86400000));
    const fired = await notifyIfNotRecent(
      manager.id,
      "accreditation.expiring",
      `${a.rider.firstName} ${a.rider.lastName} · ${a.body} ${a.title}`,
      `Expires in ${days} day${days === 1 ? "" : "s"} (${a.expiresAt!.toISOString().slice(0, 10)}). Renew before then to keep eligibility.`,
      `/accreditations`,
      a.id,
    );
    if (fired) notified++;
    else skipped++;
  }

  return { job: "accreditation_expiry", scanned, notified, skipped };
}

// Small helper — checks for a notification of the same (userId, type, rowId)
// within the last 7 days before creating a new one. Standalone (not in
// notify.ts) because the dedup key includes the accreditation id, which
// isn't a generic concept there.
async function notifyIfNotRecent(
  userId: string,
  type: string,
  title: string,
  body: string,
  link: string,
  rowId: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 7 * 86400000);
  const recent = await prisma.notification.findFirst({
    where: { userId, type, createdAt: { gte: since }, body: { contains: rowId } },
    select: { id: true },
  });
  if (recent) return false;
  await prisma.notification.create({
    data: { userId, type, title, body: `${body}\n\n[ref:${rowId}]`, link },
  });
  return true;
}

export type SweepOpts = { force?: boolean };

// Recycle-bin auto-purge — permanently delete catalog rows soft-deleted more
// than 30 days ago. Best-effort per row: items still referenced by history
// (FK) are skipped and stay in the bin rather than erroring the whole sweep.
export async function sweepBinPurge(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const where = { active: false, deletedAt: { lt: cutoff } } as const;
  const models: { name: string; delegate: any }[] = [
    { name: "vendor", delegate: prisma.vendor },
    { name: "medicine", delegate: prisma.medicine },
    { name: "consumable", delegate: prisma.consumable },
    { name: "team", delegate: prisma.team },
  ];
  let purged = 0;
  let skipped = 0;
  for (const m of models) {
    const rows = await m.delegate.findMany({ where, select: { id: true } });
    for (const r of rows) {
      try {
        await m.delegate.delete({ where: { id: r.id } });
        purged += 1;
      } catch {
        // FK-referenced (expenses / usages / movements / members) — leave it.
        skipped += 1;
      }
    }
  }
  return { job: "bin_purge", scanned: purged + skipped, notified: purged, skipped };
}

export const SWEEP_JOBS: Record<string, (opts?: SweepOpts) => Promise<SweepResult>> = {
  fee_due: () => sweepFeeDue(),
  medicine_expiry: () => sweepMedicineExpiry(),
  horse_insurance_expiry: () => sweepHorseInsuranceExpiry(),
  farrier_digest: () => sweepFarrierDigest(),
  vaccination_due: () => sweepVaccinationDue(),
  absence_escalation: () => sweepAbsenceEscalation(),
  birthdays: () => sweepBirthdays(),
  monthly_reports: (opts?: SweepOpts) => sweepMonthlyReports(opts),
  trial_end: () => sweepTrialEnd(),
  equipment_low_stock: () => sweepEquipmentLowStock(),
  accreditation_expiry: () => sweepAccreditationExpiry(),
  audit_retention: () => sweepAuditRetention(),
  dpdpa_deletions: () => sweepDpdpaDeletions(),
  dunning: () => sweepDunning(),
  tenant_offboarding: () => sweepTenantOffboarding(),
  bin_purge: () => sweepBinPurge(),
};

import { prisma } from "../prisma";
import { notify } from "../notify";
import { sendEmail, renderEmail } from "../email";
import { SweepResult, centreManagerId, recentlyNotified } from "./shared";

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

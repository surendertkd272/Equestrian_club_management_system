import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can, type Permission } from "@/lib/permissions";
import { scopeCentreForRoute, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { toCsv, csvResponse } from "@/lib/csv";
import { resolveCentreTz } from "@/lib/centre-tz";
import { endOfDayInTz } from "@/lib/tz";

// Single dispatcher for CSV exports — saves on boilerplate (auth + scoping +
// content-type plumbing) so adding a new export is just a clause in the
// switch. All exports respect tenant scoping via centreWhere().
//
// Every branch counts the unscoped-by-cap total and returns response headers
// (X-Total-Count, X-Returned-Count, X-Truncated) so the UI can warn when
// the file the user just downloaded was capped.
const ALLOWED = new Set([
  "riders",
  "horses",
  "attendance",
  "invoices",
  // Money out and money in. Invoices were the ONLY financial entity a club
  // could get out of the product, so an accountant reconciling a month had no
  // way to export what was actually collected, what was spent, or what was
  // paid to staff — the numbers existed only on screen.
  "payments",
  "expenses",
  "salary",
  "advances",
  "audit",
]);

const ROW_CAP = 5000;

// What each export requires. The route previously checked only that a session
// existed, so ANY signed-in user — a coach, an examiner, a 15-year-old on the
// student portal — could download the full rider list with phone numbers and
// email addresses, the invoice ledger, and (once the financial exports were
// added) the entire staff payroll with every colleague's gross and net pay.
// Only `audit` was gated.
//
// Mapped to the permission that already governs the same data elsewhere, so a
// role that can read something on screen can still export it and nobody gains
// or loses anything they legitimately had: coaches keep the attendance export
// their own page offers, finance stays with finance.
const EXPORT_PERMISSION: Record<string, Permission> = {
  riders: "rider.read",
  attendance: "rider.read",
  horses: "horse.manage",
  invoices: "finance.read",
  payments: "finance.read",
  expenses: "finance.read",
  salary: "finance.read",
  advances: "finance.read",
  // audit keeps its own stricter SUPER_ADMIN-only check further down.
};

// A per-row read permission is NOT a licence to dump the whole table.
// rider.read is held by RIDER and PARENT so the portals can show a child their
// own record — mapping the roster export to it therefore handed a 15-year-old
// the full rider list with every family's phone number and email, and the
// complete attendance register. INSPECTION_OFFICER is an external auditor
// scoped to inventory checks and has no business bulk-exporting children's
// contact details either. These roles have their own scoped endpoints
// (/api/parent/children, /api/student/me) and never need a bulk export.
const NO_BULK_EXPORT: readonly string[] = ["RIDER", "PARENT", "INSPECTION_OFFICER"];

export async function GET(req: Request, { params }: { params: { entity: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!ALLOWED.has(params.entity)) return NextResponse.json({ error: "UNKNOWN_ENTITY" }, { status: 404 });

  if (NO_BULK_EXPORT.includes(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const needed = EXPORT_PERMISSION[params.entity];
  if (needed && !can(session.role, needed)) {
    return NextResponse.json({ error: "FORBIDDEN", needed }, { status: 403 });
  }

  // Org-scope everything: an HQ user's "all centres" must mean "all centres in
  // MY org", never every tenant's data. Fail closed if the org can't resolve.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) return NextResponse.json({ error: "NO_ORG" }, { status: 403 });
  const scoped = scopeCentreForRoute(session);
  if (scoped.error) return scoped.error;
  const centreId = scoped.centreId;
  const where = tenantWhere(centreId, orgId);
  const ts = new Date().toISOString().slice(0, 10);

  if (params.entity === "riders") {
    const [total, rows] = await Promise.all([
      prisma.rider.count({ where }),
      prisma.rider.findMany({
        where,
        include: { batch: { select: { name: true } }, centre: { select: { name: true } } },
        orderBy: { lastName: "asc" },
        take: ROW_CAP,
      }),
    ]);
    const csv = toCsv(
      ["First name", "Last name", "Mobile", "Email", "Joining date", "Batch", "Level", "Status", "Centre"],
      rows.map((r) => [
        r.firstName,
        r.lastName,
        r.mobile,
        r.email ?? "",
        r.joiningDate.toISOString().slice(0, 10),
        r.batch?.name ?? "",
        r.currentLevel ?? "",
        r.status,
        r.centre?.name ?? "",
      ]),
    );
    return csvResponse(`riders-${ts}.csv`, csv, { total, returned: rows.length, truncated: total > rows.length });
  }

  if (params.entity === "horses") {
    const [total, rows] = await Promise.all([
      prisma.horse.count({ where }),
      prisma.horse.findMany({
        where,
        include: { centre: { select: { name: true } } },
        orderBy: { name: "asc" },
        take: ROW_CAP,
      }),
    ]);
    const csv = toCsv(
      ["Name", "Breed", "Sex", "Age (yrs)", "Stable", "Ownership", "Status", "Centre"],
      rows.map((h) => [
        h.name,
        h.breed ?? "",
        h.sex ?? "",
        h.ageYears ?? "",
        h.stableNo ?? "",
        h.ownership,
        h.status,
        h.centre?.name ?? "",
      ]),
    );
    return csvResponse(`horses-${ts}.csv`, csv, { total, returned: rows.length, truncated: total > rows.length });
  }

  if (params.entity === "attendance") {
    // Default to last 30 days unless ?from/?to supplied.
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    // Upper bound must be the END of the club's day, not "now". Attendance rows
    // are stored at UTC noon (parseDateOnly), so an unbounded export taken
    // before 12:00 UTC — i.e. before 17:30 IST, which is most of a working day
    // — silently excluded today's entire register with no warning. Marking a
    // 6 AM batch and exporting it at 9 AM produced a file without it.
    const tz = await resolveCentreTz(centreId);
    const toDate = to ? endOfDayInTz(new Date(to), tz) : endOfDayInTz(new Date(), tz);
    const attWhere = {
      date: { gte: fromDate, lte: toDate },
      // Org-bind via the batch's centre; narrow to one centre when scoped.
      batch: { ...(centreId ? { centreId } : {}), centre: { orgId } },
    };
    const [total, rows] = await Promise.all([
      prisma.attendance.count({ where: attWhere as any }),
      prisma.attendance.findMany({
        where: attWhere as any,
        include: {
          rider: { select: { firstName: true, lastName: true } },
          batch: { select: { name: true } },
        },
        orderBy: { date: "desc" },
        take: ROW_CAP,
      }),
    ]);
    const csv = toCsv(
      ["Date", "Rider", "Batch", "Status", "Reason"],
      rows.map((a) => [
        a.date.toISOString().slice(0, 10),
        `${a.rider?.firstName ?? ""} ${a.rider?.lastName ?? ""}`.trim(),
        a.batch?.name ?? "",
        a.status,
        a.reason ?? "",
      ]),
    );
    return csvResponse(`attendance-${ts}.csv`, csv, {
      total,
      returned: rows.length,
      truncated: total > rows.length,
    });
  }

  if (params.entity === "invoices") {
    const [total, rows] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        include: {
          rider: { select: { firstName: true, lastName: true } },
          centre: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: ROW_CAP,
      }),
    ]);
    const csv = toCsv(
      ["Invoice", "Kind", "Rider", "Amount", "GST", "Status", "Issued", "Due", "Centre"],
      rows.map((i) => [
        i.id.slice(0, 8),
        i.kind,
        `${i.rider?.firstName ?? ""} ${i.rider?.lastName ?? ""}`.trim(),
        i.amount,
        i.gstAmount,
        i.status,
        i.createdAt.toISOString().slice(0, 10),
        i.dueDate.toISOString().slice(0, 10),
        i.centre?.name ?? "",
      ]),
    );
    return csvResponse(`invoices-${ts}.csv`, csv, { total, returned: rows.length, truncated: total > rows.length });
  }

  if (params.entity === "payments") {
    const invWhere = { invoice: where };
    const [total, rows] = await Promise.all([
      prisma.payment.count({ where: invWhere }),
      prisma.payment.findMany({
        where: invWhere,
        include: {
          invoice: {
            include: { rider: { select: { firstName: true, lastName: true } }, centre: { select: { name: true } } },
          },
        },
        orderBy: { paidAt: "desc" },
        take: ROW_CAP,
      }),
    ]);
    const csv = toCsv(
      ["Receipt", "Invoice", "Rider", "Amount", "Method", "Reference", "Paid on", "Cleared on", "Centre"],
      rows.map((p) => [
        p.id.slice(0, 8),
        p.invoiceId.slice(0, 8),
        `${p.invoice.rider?.firstName ?? ""} ${p.invoice.rider?.lastName ?? ""}`.trim(),
        p.amount,
        p.method,
        p.txnRef ?? "",
        p.paidAt.toISOString().slice(0, 10),
        p.clearedAt ? p.clearedAt.toISOString().slice(0, 10) : "",
        p.invoice.centre?.name ?? "",
      ]),
    );
    return csvResponse(`payments-${ts}.csv`, csv, { total, returned: rows.length, truncated: total > rows.length });
  }

  if (params.entity === "expenses") {
    const [total, rows] = await Promise.all([
      prisma.expense.count({ where }),
      prisma.expense.findMany({
        where,
        include: {
          vendor: { select: { name: true } },
          category: { select: { name: true } },
          centre: { select: { name: true } },
        },
        orderBy: { spentAt: "desc" },
        take: ROW_CAP,
      }),
    ]);
    const csv = toCsv(
      ["Ref", "Spent on", "Category", "Vendor", "Amount", "GST", "Total", "Paid", "Paid on", "Method", "Description", "Centre"],
      rows.map((e) => [
        e.id.slice(0, 8),
        e.spentAt.toISOString().slice(0, 10),
        e.category?.name ?? "",
        e.vendor?.name ?? "",
        e.amount,
        e.gstAmount,
        e.amount + e.gstAmount,
        e.paid ? "yes" : "no",
        e.paidAt ? e.paidAt.toISOString().slice(0, 10) : "",
        e.method ?? "",
        e.description ?? "",
        e.centre?.name ?? "",
      ]),
    );
    return csvResponse(`expenses-${ts}.csv`, csv, { total, returned: rows.length, truncated: total > rows.length });
  }

  if (params.entity === "salary") {
    const [total, rows] = await Promise.all([
      // Voided runs are excluded — they are corrections, not spend.
      prisma.salaryPayment.count({ where: { ...where, voidedAt: null } }),
      prisma.salaryPayment.findMany({
        where: { ...where, voidedAt: null },
        include: { user: { select: { name: true, role: true } }, centre: { select: { name: true } } },
        orderBy: [{ periodMonth: "desc" }, { createdAt: "desc" }],
        take: ROW_CAP,
      }),
    ]);
    const csv = toCsv(
      ["Ref", "Month", "Staff", "Role", "Gross", "Advance recovered", "Attendance deduction", "Other deductions", "Net", "Method", "Paid on", "Centre"],
      rows.map((sp) => [
        sp.id.slice(0, 8),
        sp.periodMonth,
        sp.user?.name ?? "",
        sp.user?.role ?? "",
        sp.grossAmount,
        sp.advanceDeducted,
        sp.attendanceDeducted,
        sp.otherDeductions,
        sp.netAmount,
        sp.method ?? "",
        sp.paidAt ? sp.paidAt.toISOString().slice(0, 10) : "",
        sp.centre?.name ?? "",
      ]),
    );
    return csvResponse(`salary-${ts}.csv`, csv, { total, returned: rows.length, truncated: total > rows.length });
  }

  if (params.entity === "advances") {
    const [total, rows] = await Promise.all([
      prisma.employeeAdvance.count({ where }),
      prisma.employeeAdvance.findMany({
        where,
        include: {
          user: { select: { name: true, role: true } },
          centre: { select: { name: true } },
          // Outstanding is derived, not stored — sum what has been repaid.
          repayments: { select: { amount: true } },
        },
        orderBy: { givenAt: "desc" },
        take: ROW_CAP,
      }),
    ]);
    const csv = toCsv(
      ["Ref", "Staff", "Role", "Reason", "Amount", "Repaid", "Outstanding", "Status", "Issued", "Centre"],
      rows.map((a) => {
        const repaid = a.repayments.reduce((t, r) => t + r.amount, 0);
        return [
          a.id.slice(0, 8),
          a.user?.name ?? "",
          a.user?.role ?? "",
          a.reason,
          a.amount,
          repaid,
          Math.max(0, a.amount - repaid),
          a.status,
          a.givenAt.toISOString().slice(0, 10),
          a.centre?.name ?? "",
        ];
      }),
    );
    return csvResponse(`advances-${ts}.csv`, csv, { total, returned: rows.length, truncated: total > rows.length });
  }

  if (params.entity === "audit") {
    if (session.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    // AuditLog has no org column — scope by the actor's org (HQ users carry
    // orgId; centre staff resolve via centre.orgId). System rows (userId null)
    // are platform-level and excluded from a per-org export.
    const auditWhere = { user: { OR: [{ orgId }, { centre: { orgId } }] } };
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where: auditWhere }),
      prisma.auditLog.findMany({
        where: auditWhere,
        orderBy: { at: "desc" },
        take: ROW_CAP,
        include: { user: { select: { name: true, email: true } } },
      }),
    ]);
    const csv = toCsv(
      ["When", "User", "Email", "Action", "Table", "Row", "IP"],
      rows.map((l) => [
        l.at.toISOString(),
        l.user?.name ?? "",
        l.user?.email ?? "",
        l.action,
        l.tableName,
        l.rowId,
        l.ip ?? "",
      ]),
    );
    return csvResponse(`audit-${ts}.csv`, csv, { total, returned: rows.length, truncated: total > rows.length });
  }

  return NextResponse.json({ error: "UNKNOWN_ENTITY" }, { status: 404 });
}

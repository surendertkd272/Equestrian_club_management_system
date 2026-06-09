import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { toCsv, csvResponse } from "@/lib/csv";

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
  "audit",
]);

const ROW_CAP = 5000;

export async function GET(req: Request, { params }: { params: { entity: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!ALLOWED.has(params.entity)) return NextResponse.json({ error: "UNKNOWN_ENTITY" }, { status: 404 });

  // Org-scope everything: an HQ user's "all centres" must mean "all centres in
  // MY org", never every tenant's data. Fail closed if the org can't resolve.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) return NextResponse.json({ error: "NO_ORG" }, { status: 403 });
  const centreId = scopeCentre(session);
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
    const toDate = to ? new Date(to) : new Date();
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

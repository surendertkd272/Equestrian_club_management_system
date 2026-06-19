import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";

// Resolve the audit runs (inspections) a session should see on /inspections.
//
// Extracted from the page so the visibility rule is unit-testable without an
// RSC render. The rule:
//   • HQ (SUPER_ADMIN/ADMIN) with no centre picked → centreId is null, which
//     tenantWhere turns into the org-wide { centre: { orgId } } filter, so they
//     see every centre's runs in their org.
//   • Centre-scoped roles (INSPECTION_OFFICER, CENTRE_MANAGER) are pinned to
//     their own centre by scopeCentre.
// orgId is returned so the page can fail closed (redirect) when it can't be
// resolved. getOrgIdForSession also binds the RLS org context before the query,
// so the result is independently re-bounded to the caller's org at the DB.
export async function loadInspectionRuns(session: SessionPayload) {
  const orgId = await getOrgIdForSession(session);
  if (!orgId) {
    return { orgId: null as string | null, centreId: null as string | null, runs: [] as AuditRunRow[] };
  }
  const centreId = scopeCentre(session);
  const runs = await prisma.auditRun.findMany({
    where: tenantWhere(centreId, orgId),
    orderBy: { startedAt: "desc" },
    take: 60,
    include: { items: { select: { result: true } } },
  });
  return { orgId, centreId, runs };
}

export type AuditRunRow = Awaited<
  ReturnType<typeof prisma.auditRun.findMany<{ include: { items: { select: { result: true } } } }>>
>[number];

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff, getOrgIdForSession } from "@/lib/features-gate";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { notifyCentreManager, notifyRiderAndParents } from "@/lib/notify";
import { createInjurySchema } from "@/lib/schemas/injury";
import { scopeCentreForRoute, tenantWhere } from "@/lib/tenancy";

// GET — list injuries scoped to the caller's centre. Optional ?subjectType,
// ?subjectId for filtering to one rider/horse's history.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "injuries");
  if (featureBlock) return featureBlock;

  const url = new URL(req.url);
  const subjectType = url.searchParams.get("subjectType");
  const subjectId = url.searchParams.get("subjectId");

  // Injury rows carry children's medical detail (allergies, epilepsy, diabetes,
  // "sent to hospital"). Scope has to fail CLOSED.
  //
  // The previous guard was `if (role !== "SUPER_ADMIN" && session.centreId)`,
  // which silently did nothing for any role whose centreId is null. A PARENT
  // legitimately has centreId = null, so the filter never applied and the query
  // returned the most recent 100 injury rows for EVERY rider in EVERY club —
  // reproduced with a parent cookie returning another club's child's record.
  //
  // Portal roles have no business on this endpoint at all; everyone else is
  // pinned to their own centre and org.
  if (session.role === "PARENT" || session.role === "RIDER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const scoped = scopeCentreForRoute(session);
  if (scoped.error) return scoped.error;
  const orgId = await getOrgIdForSession(session);
  if (!orgId) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const where: Prisma.InjuryLogWhereInput = { ...tenantWhere(scoped.centreId, orgId) };
  if (subjectType) where.subjectType = subjectType;
  if (subjectId) where.subjectId = subjectId;

  const rows = await prisma.injuryLog.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ rows });
}

// POST — record a new injury. Anyone in the centre with a session can log
// one (a groom or coach may be the first to notice). The audit log + parent
// notification keeps everyone in the loop.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "injuries");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  // No centre gate here. The row's centre is taken from the rider or horse the
  // injury is about (below), so an HQ user — who has no centre of their own —
  // has everything needed; this check only ever refused them. The centreFence
  // below still binds them to their own organisation.

  const body = await req.json().catch(() => null);
  const parsed = createInjurySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // Date sanity: an injury can't be logged as having occurred in the future.
  // Allow a 1-day grace so a date-only entry near a timezone boundary (the
  // string parses to UTC midnight) isn't falsely rejected.
  const occurredAt = new Date(d.occurredAt);
  if (occurredAt.getTime() > Date.now() + 86_400_000) {
    return NextResponse.json({ error: "OCCURRED_IN_FUTURE", message: "Injury date can't be in the future." }, { status: 400 });
  }

  // Resolve the subject's centreId so the row carries the right tenancy scope.
  let centreId: string | null = null;
  let horseSubjectId: string | null = null;
  let subjectName: string = "";
  if (d.subjectType === "horse") {
    const h = await prisma.horse.findUnique({
      where: { id: d.subjectId },
      select: { centreId: true, name: true },
    });
    if (!h) return NextResponse.json({ error: "SUBJECT_NOT_FOUND" }, { status: 404 });
    centreId = h.centreId;
    horseSubjectId = d.subjectId;
    subjectName = h.name;
  } else {
    const r = await prisma.rider.findUnique({
      where: { id: d.subjectId },
      select: { centreId: true, firstName: true, lastName: true },
    });
    if (!r) return NextResponse.json({ error: "SUBJECT_NOT_FOUND" }, { status: 404 });
    centreId = r.centreId;
    subjectName = `${r.firstName} ${r.lastName}`;
  }
  // Locks ADMIN out (centreId = null) and org-fences nobody. Same helper as
  // everywhere else; the centre here comes from the subject, not the session.
  const fence = await centreFence(session, centreId);
  if (fence) {
    return NextResponse.json({ error: fence }, { status: 403 });
  }

  const row = await prisma.injuryLog.create({
    data: {
      centreId,
      subjectType: d.subjectType,
      subjectId: d.subjectId,
      horseSubjectId,
      occurredAt,
      location: d.location ?? null,
      severity: d.severity,
      cause: d.cause ?? null,
      initialNotes: d.initialNotes,
      reportedBy: session.userId,
    },
  });

  await audit({
    userId: session.userId,
    action: "injury.report",
    tableName: "injuryLog",
    rowId: row.id,
    after: { subjectType: d.subjectType, subjectId: d.subjectId, severity: d.severity },
  });

  // Manager heads-up: severe injuries get pinged immediately.
  if (d.severity !== "minor") {
    await notifyCentreManager(centreId, {
      type: "injury.reported",
      title: `${d.severity.toUpperCase()} injury — ${subjectName}`,
      body: `${d.location ?? "no location"}. ${d.initialNotes.slice(0, 140)}`,
      link: `/injuries`,
      payload: { injuryId: row.id, subjectType: d.subjectType, subjectId: d.subjectId },
    });

    // ...and the family. This header comment has claimed since day one that
    // "the audit log + parent notification keeps everyone in the loop", but no
    // parent notification existed: a child could be sent to hospital and the
    // only person told was the centre manager. Verified by logging a severe
    // rider injury and watching the parent's and rider's unread counts stay
    // exactly where they were.
    if (d.subjectType === "rider") {
      await notifyRiderAndParents(d.subjectId, {
        type: "injury.reported",
        title: `${subjectName} was injured at the centre`,
        body: `${d.severity} injury${d.location ? ` — ${d.location}` : ""}. ${d.initialNotes.slice(0, 200)} The centre has been notified; please contact them for details.`,
        link: `/parent`,
        criticality: "critical",
      });
    }
  }

  return NextResponse.json({ ok: true, id: row.id });
}

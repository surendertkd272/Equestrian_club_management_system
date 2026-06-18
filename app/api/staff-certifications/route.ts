import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff, getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { issueCertSchema } from "@/lib/schemas/courses";

// GET — list certifications. ?userId to filter to one staff member's history.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "training-certs");
  if (featureBlock) return featureBlock;
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const where: Prisma.StaffCertificationWhereInput = {};
  if (session.role !== "SUPER_ADMIN" && session.centreId) where.centreId = session.centreId;
  if (userId) where.userId = userId;

  const rows = await prisma.staffCertification.findMany({
    where,
    orderBy: { issuedAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ rows });
}

// POST — issue a certification. Supports both course-completion certs and
// external certs (BHS, EFI, etc.) via courseId=null + issuer.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "training-certs");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = issueCertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  // Derive the cert's centre from the TARGET user, never from a body-supplied
  // centreId (issueCertSchema has no centreId field, so body.centreId was
  // unvalidated Zod-bypassed input). Also enforce that the caller may issue to
  // this user: centre-scoped callers only within their centre; HQ within org.
  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { centreId: true },
  });
  if (!target || !target.centreId) {
    return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
  }
  if (session.role !== "SUPER_ADMIN") {
    if (session.centreId) {
      if (target.centreId !== session.centreId) {
        return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
      }
    } else {
      const [callerOrg, targetOrg] = await Promise.all([
        getOrgIdForSession(session),
        getOrgIdForCentre(target.centreId),
      ]);
      if (!callerOrg || targetOrg !== callerOrg) {
        return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
      }
    }
  }
  const centreId = target.centreId;

  const row = await prisma.staffCertification.create({
    data: {
      centreId,
      userId: parsed.data.userId,
      courseId: parsed.data.courseId ?? null,
      title: parsed.data.title,
      issuer: parsed.data.issuer ?? null,
      serialNo: parsed.data.serialNo ?? null,
      validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : null,
      fileUrl: parsed.data.fileUrl || null,
    },
  });
  await audit({
    userId: session.userId,
    action: "staff_cert.issue",
    tableName: "staffCertification",
    rowId: row.id,
    after: { userId: parsed.data.userId, title: row.title },
  });
  return NextResponse.json({ ok: true, id: row.id });
}

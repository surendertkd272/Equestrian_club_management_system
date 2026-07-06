import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { resolveWriteCentre } from "@/lib/resolve-centre";
import { createCourseSchema } from "@/lib/schemas/courses";

// GET — list courses for the caller's centre. ?active=1 filter for the "what
// can I sign up for?" view.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "training-certs");
  if (featureBlock) return featureBlock;
  const url = new URL(req.url);
  const where: Prisma.CourseWhereInput = {};
  if (session.role !== "SUPER_ADMIN" && session.centreId) where.centreId = session.centreId;
  if (url.searchParams.get("active") === "1") where.active = true;

  const rows = await prisma.course.findMany({
    where,
    orderBy: [{ active: "desc" }, { title: "asc" }],
    include: { _count: { select: { enrolments: true, certifications: true } } },
  });
  return NextResponse.json({ rows });
}

// POST — create a course. Permission: staff.manage (centre managers + HQ).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "training-certs");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createCourseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  // HQ users have centreId=null and this form doesn't send a centreId — resolve
  // via the top-bar picker so HQ can create training courses for the centre.
  const resolved = await resolveWriteCentre(session, body);
  if (resolved.error) return resolved.error;
  const { centreId } = resolved;

  const row = await prisma.course.create({
    data: {
      centreId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      targetRoles: parsed.data.targetRoles ? parsed.data.targetRoles.join(",") : null,
      durationHrs: parsed.data.durationHrs ?? null,
      passingMark: parsed.data.passingMark ?? null,
    },
  });
  await audit({
    userId: session.userId,
    action: "course.create",
    tableName: "course",
    rowId: row.id,
    after: { title: row.title },
  });
  return NextResponse.json({ ok: true, id: row.id });
}

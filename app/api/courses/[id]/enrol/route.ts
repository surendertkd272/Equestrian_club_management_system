import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { enrolSchema, finishEnrolmentSchema } from "@/lib/schemas/courses";

// POST /api/courses/[id]/enrol — enrol a staff user into a course. Unique on
// (courseId, userId) so re-enrolling becomes a no-op (returns existing row).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "training-certs");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = enrolSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const course = await prisma.course.findUnique({ where: { id: params.id } });
  if (!course) return NextResponse.json({ error: "COURSE_NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && course.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  // The enrolled user must belong to the course's centre — a course is
  // centre-specific, so don't trust a body-supplied userId from another centre.
  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { centreId: true },
  });
  if (!target) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
  if (target.centreId !== course.centreId) {
    return NextResponse.json({ error: "USER_CROSS_CENTRE" }, { status: 403 });
  }

  const row = await prisma.courseEnrolment.upsert({
    where: { courseId_userId: { courseId: course.id, userId: parsed.data.userId } },
    create: { courseId: course.id, userId: parsed.data.userId },
    update: {},
  });
  await audit({
    userId: session.userId,
    action: "course.enrol",
    tableName: "courseEnrolment",
    rowId: row.id,
    after: { userId: parsed.data.userId, courseId: course.id },
  });
  return NextResponse.json({ ok: true, id: row.id });
}

// PATCH — finish the enrolment: set status = completed/dropped + finalMark.
// Body shape: { enrolmentId, finalMark?, status }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "training-certs");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = finishEnrolmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const enrolmentId = (body?.enrolmentId as string | undefined) ?? "";
  if (!enrolmentId) return NextResponse.json({ error: "enrolmentId required" }, { status: 400 });

  const e = await prisma.courseEnrolment.findUnique({
    where: { id: enrolmentId },
    include: { course: { select: { centreId: true } } },
  });
  if (!e || e.courseId !== params.id) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // Same cross-centre guard as POST — the enrolment's course must be in scope.
  if (session.role !== "SUPER_ADMIN" && e.course.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const updated = await prisma.courseEnrolment.update({
    where: { id: e.id },
    data: {
      status: parsed.data.status,
      finalMark: parsed.data.finalMark ?? null,
      finishedAt: new Date(),
    },
  });
  await audit({
    userId: session.userId,
    action: "course.enrolment_finished",
    tableName: "courseEnrolment",
    rowId: e.id,
    after: { status: updated.status, finalMark: updated.finalMark },
  });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { issueCertSchema } from "@/lib/schemas/courses";

// GET — list certifications. ?userId to filter to one staff member's history.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
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
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = issueCertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const centreId = session.centreId ?? (body?.centreId as string | undefined);
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE" }, { status: 400 });

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

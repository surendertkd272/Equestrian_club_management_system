import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { createAccreditationSchema } from "@/lib/schemas/accreditation";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";

// GET — list accreditations. Filter by ?riderId= for a single rider, or
// query the whole centre (SUPER_ADMIN sees platform-wide).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const url = new URL(req.url);
  const riderId = url.searchParams.get("riderId");
  const centreId = scopeCentre(session);

  const where: any = {};
  if (riderId) where.riderId = riderId;
  // Tenant scoping — rider must be in the caller's centre unless SUPER_ADMIN.
  if (centreId) where.rider = { centreId };

  const rows = await prisma.accreditation.findMany({
    where,
    include: { rider: { select: { firstName: true, lastName: true } } },
    orderBy: { issuedAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ accreditations: rows });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "accreditation.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const featureBlock = await blockIfFeatureOff(session, "accreditations");
  if (featureBlock) return featureBlock;
  const body = await req.json().catch(() => null);
  const parsed = createAccreditationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Scope check — only allow against riders the caller can see.
  const rider = await prisma.rider.findUnique({ where: { id: parsed.data.riderId } });
  if (!rider) return NextResponse.json({ error: "RIDER_NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && rider.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const row = await prisma.accreditation.create({
    data: {
      riderId: parsed.data.riderId,
      body: parsed.data.body,
      title: parsed.data.title,
      discipline: parsed.data.discipline,
      level: parsed.data.level,
      serialNo: parsed.data.serialNo,
      issuedAt: new Date(parsed.data.issuedAt),
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      fileUrl: parsed.data.fileUrl,
      notes: parsed.data.notes,
      verifiedBy: session.userId,
      verifiedAt: new Date(),
    },
  });
  await audit({
    userId: session.userId,
    action: "accreditation.create",
    tableName: "accreditation",
    rowId: row.id,
    after: { body: row.body, title: row.title, riderId: row.riderId },
  });
  return NextResponse.json({ id: row.id });
}

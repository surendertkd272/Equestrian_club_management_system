import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { updateAccreditationSchema } from "@/lib/schemas/accreditation";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "accreditation.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  const body = await req.json().catch(() => null);
  const parsed = updateAccreditationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const before = await prisma.accreditation.findUnique({
    where: { id: params.id },
    include: { rider: { select: { centreId: true } } },
  });
  if (!before) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && before.rider.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  // Cross-field date sanity (mirrors events #133): the create schema refines
  // expiresAt >= issuedAt, but this PATCH applies each independently, so a
  // one-sided edit could leave expiry before issue. Merge incoming over stored.
  const effIssued = parsed.data.issuedAt !== undefined ? new Date(parsed.data.issuedAt) : before.issuedAt;
  const effExpires =
    parsed.data.expiresAt !== undefined
      ? (parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null)
      : before.expiresAt;
  if (effExpires && effExpires < effIssued) {
    return NextResponse.json({ error: "INVALID_DATE_RANGE", message: "expiresAt must be on/after issuedAt" }, { status: 400 });
  }

  const updated = await prisma.accreditation.update({
    where: { id: before.id },
    data: {
      ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.discipline !== undefined ? { discipline: parsed.data.discipline ?? null } : {}),
      ...(parsed.data.level !== undefined ? { level: parsed.data.level ?? null } : {}),
      ...(parsed.data.serialNo !== undefined ? { serialNo: parsed.data.serialNo ?? null } : {}),
      ...(parsed.data.issuedAt !== undefined ? { issuedAt: new Date(parsed.data.issuedAt) } : {}),
      ...(parsed.data.expiresAt !== undefined
        ? { expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null }
        : {}),
      ...(parsed.data.fileUrl !== undefined ? { fileUrl: parsed.data.fileUrl ?? null } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes ?? null } : {}),
    },
  });

  await audit({
    userId: session.userId,
    action: "accreditation.update",
    tableName: "accreditation",
    rowId: updated.id,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "accreditation.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  const row = await prisma.accreditation.findUnique({
    where: { id: params.id },
    include: { rider: { select: { centreId: true } } },
  });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && row.rider.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  await prisma.accreditation.delete({ where: { id: row.id } });
  await audit({
    userId: session.userId,
    action: "accreditation.delete",
    tableName: "accreditation",
    rowId: row.id,
  });
  return NextResponse.json({ ok: true });
}

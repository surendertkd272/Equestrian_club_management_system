import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { updateCentreSchema } from "@/lib/schemas/centre";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// PATCH /api/centres/[id] — edit a club's name / address / GST.
// HQ-only: even centre managers shouldn't rename their own club from inside it,
// since the brand is owned at the HQ level.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  // HQ-tier — ADMIN can edit club details (data write); only club
  // create/delete stays SUPER_ADMIN-only (see POST + DELETE below).
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = updateCentreSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const existing = await prisma.centre.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const updated = await prisma.centre.update({
    where: { id: existing.id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.address !== undefined ? { address: d.address || null } : {}),
      ...(d.gstNo !== undefined ? { gstNo: d.gstNo || null } : {}),
      // jsonb column — pass the array directly; empty → Prisma.DbNull to clear.
      ...(d.emergencyContacts !== undefined
        ? { emergencyContactsJson: d.emergencyContacts.length === 0 ? Prisma.DbNull : d.emergencyContacts }
        : {}),
    },
  });

  await audit({
    userId: session.userId,
    action: "centre.update",
    tableName: "centre",
    rowId: existing.id,
    before: { name: existing.name, address: existing.address, gstNo: existing.gstNo },
    after: { name: updated.name, address: updated.address, gstNo: updated.gstNo },
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/centres/[id] — remove a club entirely. HQ-only.
// We refuse to delete a centre that still has *any* operational data attached
// (users, riders, horses, batches, …). The HQ admin has to either reassign
// those or empty them first. This is intentionally strict — hard-deleting a
// club with years of rider history would be irreversible and destructive.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const existing = await prisma.centre.findUnique({
    where: { id: params.id },
    include: {
      _count: {
        select: {
          users: true,
          riders: true,
          horses: true,
          batches: true,
          medicines: true,
          competitions: true,
          invoices: true,
          certificates: true,
        },
      },
    },
  });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const c = existing._count;
  const total =
    c.users + c.riders + c.horses + c.batches + c.medicines + c.competitions + c.invoices + c.certificates;
  if (total > 0) {
    return NextResponse.json(
      {
        error: "NOT_EMPTY",
        message: "Club has attached data — reassign or remove it before deleting.",
        counts: c,
      },
      { status: 409 },
    );
  }

  // Catalog data (fee plans / progress levels / skills / scoring templates) is
  // bootstrapped data — we don't count it toward "not empty". Wipe it as part
  // of the delete so the next centre with the same slug doesn't inherit it.
  await prisma.scoringTemplate.deleteMany({ where: { centreId: existing.id } });
  await prisma.feePlan.deleteMany({ where: { centreId: existing.id } });
  // Skills belong to ProgressLevel, deleteMany on level cascades to skills.
  await prisma.progressLevel.deleteMany({ where: { centreId: existing.id } });

  await prisma.centre.delete({ where: { id: existing.id } });

  await audit({
    userId: session.userId,
    action: "centre.delete",
    tableName: "centre",
    rowId: existing.id,
    before: { slug: existing.slug, name: existing.name },
  });

  return NextResponse.json({ ok: true });
}

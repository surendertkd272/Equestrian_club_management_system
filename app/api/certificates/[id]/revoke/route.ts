import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";

const schema = z.object({
  reason: z.string().min(2).max(300),
});

// Soft-revoke a certificate. The verify page reads revokedAt and renders
// the cert as REVOKED rather than active. Hard-deleting would orphan
// audit trail + remove the serial from a printed cert holder's record.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "certificates");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "certificate.bulk")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const cert = await prisma.certificate.findUnique({ where: { id: params.id } });
  if (!cert) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && cert.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (cert.revokedAt) {
    return NextResponse.json({ error: "ALREADY_REVOKED" }, { status: 409 });
  }

  await prisma.certificate.update({
    where: { id: cert.id },
    data: {
      revokedAt: new Date(),
      revokedBy: session.userId,
      revokeReason: parsed.data.reason,
    },
  });

  // Roll the rider's level back. Scoring a pass promotes the rider (see
  // exams/[id]/score), so revoking the certificate that promoted them has to
  // undo it — otherwise the club withdraws the certificate while the rider
  // keeps the rank it granted, stays in the higher batch, and is entered for
  // the next level up on the strength of an award that no longer exists.
  //
  // Only when the revoked certificate is the one holding them at that level:
  // if they still hold another live promotion for it, nothing changes. Falls
  // back to the most recent live promotion, or null for a rider whose only
  // promotion was this one.
  let levelRolledBackTo: string | null | undefined;
  if (cert.type === "promotion" && cert.levelName && cert.riderId) {
    const rider = await prisma.rider.findUnique({
      where: { id: cert.riderId },
      select: { currentLevel: true },
    });
    if (rider?.currentLevel === cert.levelName) {
      const stillHeld = await prisma.certificate.findFirst({
        where: { riderId: cert.riderId, type: "promotion", revokedAt: null, id: { not: cert.id } },
        orderBy: { issuedAt: "desc" },
        select: { levelName: true },
      });
      levelRolledBackTo = stillHeld?.levelName ?? null;
      await prisma.rider.update({
        where: { id: cert.riderId },
        data: { currentLevel: levelRolledBackTo },
      });
    }
  }

  await audit({
    userId: session.userId,
    action: "certificate.revoke",
    tableName: "certificate",
    rowId: cert.id,
    after: {
      reason: parsed.data.reason,
      ...(levelRolledBackTo !== undefined
        ? { riderLevelRolledBackFrom: cert.levelName, riderLevelRolledBackTo: levelRolledBackTo }
        : {}),
    },
  });

  return NextResponse.json({ ok: true, riderLevelRolledBackTo: levelRolledBackTo ?? null });
}

// Un-revoke (admin-only) — typo recovery.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const cert = await prisma.certificate.findUnique({ where: { id: params.id } });
  if (!cert) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!cert.revokedAt) return NextResponse.json({ error: "NOT_REVOKED" }, { status: 409 });

  await prisma.certificate.update({
    where: { id: cert.id },
    data: { revokedAt: null, revokedBy: null, revokeReason: null },
  });

  // Mirror of the rollback in POST: revoking demotes the rider, so undoing a
  // mistaken revocation has to promote them back. Without this, typo recovery
  // restored the certificate but left the rider a level down.
  let levelRestoredTo: string | undefined;
  if (cert.type === "promotion" && cert.levelName && cert.riderId) {
    const rider = await prisma.rider.findUnique({
      where: { id: cert.riderId },
      select: { currentLevel: true },
    });
    if (rider && rider.currentLevel !== cert.levelName) {
      levelRestoredTo = cert.levelName;
      await prisma.rider.update({
        where: { id: cert.riderId },
        data: { currentLevel: cert.levelName },
      });
    }
  }

  await audit({
    userId: session.userId,
    action: "certificate.unrevoke",
    tableName: "certificate",
    rowId: cert.id,
    after: levelRestoredTo ? { riderLevelRestoredTo: levelRestoredTo } : undefined,
  });
  return NextResponse.json({ ok: true, riderLevelRestoredTo: levelRestoredTo ?? null });
}

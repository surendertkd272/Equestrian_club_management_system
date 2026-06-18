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

  await audit({
    userId: session.userId,
    action: "certificate.revoke",
    tableName: "certificate",
    rowId: cert.id,
    after: { reason: parsed.data.reason },
  });

  return NextResponse.json({ ok: true });
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
  await audit({
    userId: session.userId,
    action: "certificate.unrevoke",
    tableName: "certificate",
    rowId: cert.id,
  });
  return NextResponse.json({ ok: true });
}

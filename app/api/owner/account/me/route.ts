import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";

const updateSchema = z
  .object({ name: z.string().min(2).max(120).optional() })
  .strict();

export async function GET() {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const user = await prisma.platformUser.findUnique({
    where: { id: session.ownerId },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  if (!user) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ user });
}

// Owners can update their own name. Role/email/status changes go through
// /api/owner/team (which respects the team.manage permission).
export async function PATCH(req: NextRequest) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "NO_CHANGES" }, { status: 400 });
  }

  const before = await prisma.platformUser.findUniqueOrThrow({
    where: { id: session.ownerId },
    select: { name: true },
  });

  await prisma.platformUser.update({
    where: { id: session.ownerId },
    data: { name: parsed.data.name },
  });

  await auditOwner({
    actorId: session.ownerId,
    action: "owner.account_updated",
    orgId: null,
    before,
    after: { name: parsed.data.name },
  });

  return NextResponse.json({ ok: true });
}

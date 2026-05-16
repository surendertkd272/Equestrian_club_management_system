import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { updateProfileSchema } from "@/lib/schemas/account";

// GET /api/account/me — the signed-in user's own profile snapshot.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { centre: { select: { id: true, name: true, slug: true } } },
  });
  if (!user) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      centre: user.centre,
      twoFactor: user.twoFactor,
      createdAt: user.createdAt,
    },
  });
}

// PATCH /api/account/me — edit your own name / phone. Role / email / status
// are intentionally not editable here — they go through HQ user management.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "NO_CHANGES" }, { status: 400 });
  }

  const before = await prisma.user.findUniqueOrThrow({
    where: { id: session.userId },
    select: { name: true, phone: true, photoUrl: true },
  });

  const updated = await prisma.user.update({
    where: { id: session.userId },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || null } : {}),
      ...(parsed.data.photoUrl !== undefined ? { photoUrl: parsed.data.photoUrl } : {}),
    },
  });

  await audit({
    userId: session.userId,
    action: "account.profile_updated",
    tableName: "user",
    rowId: session.userId,
    before,
    after: { name: updated.name, phone: updated.phone, photoUrl: updated.photoUrl },
  });

  return NextResponse.json({ ok: true });
}

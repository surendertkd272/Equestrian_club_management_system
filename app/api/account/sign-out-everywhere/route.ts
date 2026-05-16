import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, clearSessionCookie } from "@/lib/auth";
import { audit } from "@/lib/audit";

// POST /api/account/sign-out-everywhere — bump User.tokenVersion so every
// outstanding JWT (this browser, the office tab, the phone, the stolen
// session) is rejected on its next request. The bump happens atomically;
// we also clear this browser's cookie for immediate UX feedback.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  await prisma.user.update({
    where: { id: session.userId },
    data: { tokenVersion: { increment: 1 } },
  });

  await audit({
    userId: session.userId,
    action: "auth.signed_out_everywhere",
    tableName: "user",
    rowId: session.userId,
  });

  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}

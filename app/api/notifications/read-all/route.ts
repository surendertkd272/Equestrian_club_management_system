import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const result = await prisma.notification.updateMany({
    where: { userId: session.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true, count: result.count });
}

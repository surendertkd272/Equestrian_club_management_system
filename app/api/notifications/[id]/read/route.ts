import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const n = await prisma.notification.findUnique({ where: { id: params.id } });
  if (!n) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (n.userId !== session.userId) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  if (!n.readAt) {
    await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  }
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Used by the topbar dropdown to lazy-load a short list (limit=20) of the
// user's most recent unread notifications. The full /notifications page
// continues to read Prisma directly in an RSC.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unreadOnly") === "1";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "20") || 20, 100);

  const rows = await prisma.notification.findMany({
    where: { userId: session.userId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      link: true,
      readAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ rows });
}

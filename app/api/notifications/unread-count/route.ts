import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Polled every 60s by the topbar bell to refresh the unread badge without
// reloading the page. Returns just { count } so it's a few bytes per poll.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const count = await prisma.notification.count({
    where: { userId: session.userId, readAt: null },
  });
  return NextResponse.json({ count });
}

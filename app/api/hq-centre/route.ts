// Persists the HQ-tier admin's selected centre filter in a cookie.
// SUPER_ADMIN + ADMIN use this to scope every cross-club page to one
// centre without re-picking on each navigation.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";

const schema = z.object({
  centreId: z.string().min(1).or(z.literal("all")),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });
  // 30-day persistence so the choice survives across browser sessions.
  res.cookies.set("ew_hq_centre", parsed.data.centreId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86400,
  });
  return res;
}

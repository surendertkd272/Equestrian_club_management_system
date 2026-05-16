import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Tenant-side: list the announcements the signed-in user should see
// right now. Filters applied:
//   • publishedAt ≤ now AND (expiresAt is null OR > now)
//   • planFilter null OR includes the user's org plan
//   • roleFilter null OR includes the user's role
//   • not already dismissed by this user
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { orgId: true, centre: { select: { org: { select: { plan: true } } } }, org: { select: { plan: true } } },
  });
  const plan = me?.centre?.org?.plan ?? me?.org?.plan ?? null;

  const now = new Date();
  const candidates = await prisma.announcement.findMany({
    where: {
      publishedAt: { lte: now, not: null },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { publishedAt: "desc" },
    take: 20,
    include: {
      dismissals: { where: { userId: session.userId }, select: { dismissedAt: true } },
    },
  });

  const filtered = candidates.filter((a) => {
    if (a.dismissals.length > 0) return false;
    if (a.planFilter) {
      const allowed = a.planFilter.split(",").map((s) => s.trim().toLowerCase());
      if (!plan || !allowed.includes(plan)) return false;
    }
    if (a.roleFilter) {
      const allowed = a.roleFilter.split(",").map((s) => s.trim().toUpperCase());
      if (!allowed.includes(session.role)) return false;
    }
    return true;
  });

  return NextResponse.json({
    rows: filtered.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      ctaLabel: a.ctaLabel,
      ctaHref: a.ctaHref,
      severity: a.severity,
      publishedAt: a.publishedAt,
    })),
  });
}

// POST /api/announcements/dismiss — { id } — record user dismissal.
const dismissSchema = z.object({ id: z.string().min(1) });
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = dismissSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  await prisma.announcementDismissal.upsert({
    where: { userId_announcementId: { userId: session.userId, announcementId: parsed.data.id } },
    create: { userId: session.userId, announcementId: parsed.data.id },
    update: {},
  });
  return NextResponse.json({ ok: true });
}

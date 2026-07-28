import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";
import { storedUrl } from "@/lib/schemas/url";

// Owner-side CRUD for platform-wide announcements. Tenants consume via
// /api/announcements (a separate, session-authed endpoint).
const SEVERITIES = ["info", "success", "warning", "maintenance"] as const;

const createSchema = z.object({
  title: z.string().min(1).max(160),
  body: z.string().min(1).max(2000),
  ctaLabel: z.string().max(40).optional().nullable(),
  ctaHref: storedUrl.optional().nullable(),
  severity: z.enum(SEVERITIES).default("info"),
  planFilter: z.string().max(80).optional().nullable(),
  roleFilter: z.string().max(120).optional().nullable(),
  publishedAt: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
});

export async function GET() {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const rows = await prisma.announcement.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "OWNER_ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const row = await prisma.announcement.create({
    data: {
      title: d.title,
      body: d.body,
      ctaLabel: d.ctaLabel || null,
      ctaHref: d.ctaHref || null,
      severity: d.severity,
      planFilter: d.planFilter || null,
      roleFilter: d.roleFilter || null,
      publishedAt: d.publishedAt ? new Date(d.publishedAt) : new Date(),
      expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
      createdBy: session.ownerId,
    },
  });
  await auditOwner({
    actorId: session.ownerId,
    action: "owner.announcement_created",
    after: { id: row.id, title: row.title, severity: row.severity },
  });
  return NextResponse.json({ ok: true, id: row.id });
}

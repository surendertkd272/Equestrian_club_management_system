import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { isRole } from "@/lib/roles";
import { USER_STATUSES, createUserSchema } from "@/lib/schemas/user-admin";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// GET /api/users — HQ search/filter across every user in every club.
// Query params:
//   role=COACH          exact role match
//   centreId=<id>       exact centre match; pass "null" to find HQ users
//   status=active|suspended
//   q=<text>            case-insensitive substring match against name and email
//   skip=, take=        pagination (defaults 0 / 50, capped at 200)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(req.url);
  const role = url.searchParams.get("role");
  const centreParam = url.searchParams.get("centreId");
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q")?.trim();
  const skip = Math.max(0, Number(url.searchParams.get("skip") ?? 0));
  const take = Math.min(200, Math.max(1, Number(url.searchParams.get("take") ?? 50)));

  const where: Record<string, unknown> = {};
  if (role && isRole(role)) where.role = role;
  if (centreParam === "null") where.centreId = null;
  else if (centreParam) where.centreId = centreParam;
  if (status && (USER_STATUSES as readonly string[]).includes(status)) where.status = status;
  if (q) {
    where.OR = [{ name: { contains: q } }, { email: { contains: q } }];
  }

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      skip,
      take,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        centreId: true,
        status: true,
        createdAt: true,
        centre: { select: { name: true, slug: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return NextResponse.json({ rows, total, skip, take });
}

// POST /api/users — HQ creates a new tenant user. Password is generated
// server-side and returned ONCE — same pattern as rider portal access and
// reset-password. Role + centreId are validated; centreId=null means an
// HQ-scoped user (only SUPER_ADMIN should be left null in practice).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // An ADMIN can manage everyone except the HQ super-admin tier — only a
  // SUPER_ADMIN may mint another SUPER_ADMIN (prevents privilege escalation).
  if (session.role === "ADMIN" && d.role === "SUPER_ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN_SUPER_ADMIN" }, { status: 403 });
  }

  // Email uniqueness — friendly 409 instead of raw Prisma error.
  const dupe = await prisma.user.findUnique({ where: { email: d.email }, select: { id: true } });
  if (dupe) return NextResponse.json({ error: "EMAIL_TAKEN" }, { status: 409 });

  // Verify centre exists when supplied.
  if (d.centreId) {
    const centre = await prisma.centre.findUnique({ where: { id: d.centreId }, select: { id: true } });
    if (!centre) return NextResponse.json({ error: "CENTRE_NOT_FOUND" }, { status: 404 });
  }

  // DEFERRED — email verification (#16): we trust the admin-supplied email
  // and never confirm the user can actually receive at that address. A
  // typo (or hostile admin filling in their own address for a new account)
  // hands the temp password to the wrong inbox. Future: gate the temp
  // password behind a one-time `email-verify` link the user clicks first,
  // and only then reveal/send the password. Same applies to the email-
  // change flow once we add one. Currently signed-off because all admin
  // users are vetted manually during onboarding.
  // 12-byte base64url ≈ 16 chars; safe to copy/paste in WhatsApp/email.
  const tempPassword = crypto.randomBytes(12).toString("base64url");
  const passwordHash = await hashPassword(tempPassword);

  const user = await prisma.user.create({
    data: {
      name: d.name,
      email: d.email,
      phone: d.phone || null,
      role: d.role,
      centreId: d.centreId ?? null,
      passwordHash,
      status: "active",
      // Temp password → force them to rotate on first sign-in.
      mustChangePassword: true,
    },
  });

  await audit({
    userId: session.userId,
    action: "user.create",
    tableName: "user",
    rowId: user.id,
    after: { email: user.email, role: user.role, centreId: user.centreId },
  });

  return NextResponse.json({
    ok: true,
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    centreId: user.centreId,
    tempPassword,
  });
}

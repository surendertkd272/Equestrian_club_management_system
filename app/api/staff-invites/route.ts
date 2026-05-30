// Staff hiring invites — one-person, single-use, email-locked. POST creates a
// staff_hire ShortLink with singleUse=true and the invitee's email/name/role
// stashed in paramsJson; the public /staff-register/<code> page locks the
// email to that person and the registration API rejects mismatches + reuse.
// GET lists the centre's open (unused, unexpired) invites.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, centreWhere } from "@/lib/tenancy";
import { generateShortCode } from "@/lib/schemas/short-link";
import { createStaffInviteSchema } from "@/lib/schemas/staff-invite";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

function canInvite(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "CENTRE_MANAGER";
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canInvite(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const centreId = scopeCentre(session);
  const links = await prisma.shortLink.findMany({
    where: { ...centreWhere(centreId), kind: "staff_hire" },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  // Decorate with the locked email + used/expired state.
  const now = new Date();
  const invites = links.map((l) => {
    let email: string | null = null;
    let role: string | null = null;
    let name: string | null = null;
    // paramsJson is a jsonb column — Prisma returns the parsed object.
    if (l.paramsJson && typeof l.paramsJson === "object" && !Array.isArray(l.paramsJson)) {
      const p = l.paramsJson as Record<string, unknown>;
      email = typeof p.email === "string" ? p.email : null;
      role = typeof p.role === "string" ? p.role : null;
      name = typeof p.name === "string" ? p.name : null;
    }
    const used = l.singleUse && l.redeemCount > 0;
    const expired = !!l.expiresAt && l.expiresAt < now;
    return {
      code: l.code,
      email,
      name,
      role,
      used,
      expired,
      createdAt: l.createdAt.toISOString(),
      expiresAt: l.expiresAt?.toISOString() ?? null,
    };
  });
  return NextResponse.json({ invites });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canInvite(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const centreId = scopeCentre(session);
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = createStaffInviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  // Email is optional — empty string means the admin will share the link
  // manually instead of email-locking it. null'd out for clarity.
  const email = parsed.data.email && parsed.data.email.length > 0
    ? parsed.data.email.toLowerCase()
    : null;

  // Email-locked invites can't go to someone who already has an account.
  // Email-less invites skip this check — there's no email to collide on.
  if (email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "EMAIL_IN_USE", message: "An account with this email already exists." },
        { status: 409 },
      );
    }
  }

  // Generate a unique code.
  let code = "";
  for (let i = 0; i < 5; i++) {
    code = generateShortCode(8);
    const clash = await prisma.shortLink.findUnique({ where: { code } });
    if (!clash) break;
    code = "";
  }
  if (!code) return NextResponse.json({ error: "CODE_GENERATION_FAILED" }, { status: 500 });

  const link = await prisma.shortLink.create({
    data: {
      code,
      centreId,
      kind: "staff_hire",
      targetPath: "/staff-register",
      // jsonb column — pass the object directly (post-migration in 81f142a).
      // email may be null for shared-link invites; the redemption page reads
      // paramsJson.email and skips the email-match check when it's null.
      paramsJson: { email, name: parsed.data.name ?? null, role: parsed.data.role },
      label: email ? `Staff invite — ${email}` : `Staff invite — ${parsed.data.name ?? parsed.data.role}`,
      expiresAt: new Date(Date.now() + parsed.data.expiresInDays * 86400000),
      singleUse: true,
      createdByUserId: session.userId,
    },
  });

  await audit({
    userId: session.userId,
    action: "staff_invite.create",
    tableName: "shortLink",
    rowId: link.id,
    after: { email, role: parsed.data.role, code },
  });

  return NextResponse.json({ ok: true, code });
}

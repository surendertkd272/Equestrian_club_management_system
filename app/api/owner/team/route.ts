import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  getOwnerSession,
  hashOwnerPassword,
} from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";
import { forbidIfMissingOwnerPerm } from "@/lib/owner-permissions";
import { inviteOwnerSchema } from "@/lib/schemas/platform-user";

// GET /api/owner/team — list every platform user. Anyone signed in to the
// owner portal can see the team list (it's a small group); only ADMIN can
// mutate.
export async function GET() {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const users = await prisma.platformUser.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      twoFactor: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ users });
}

// POST /api/owner/team — invite a new platform team member. Returns a one-time
// temp password to share with them. They sign in at /owner/login and rotate
// their password from the account page (or via reset-password — Phase 8.1 if
// we need it; for now they ask another admin to re-invite if they lose it).
export async function POST(req: NextRequest) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const block = forbidIfMissingOwnerPerm(session.role, "team.manage");
  if (block) return block;

  const body = await req.json().catch(() => null);
  const parsed = inviteOwnerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const dupe = await prisma.platformUser.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });
  if (dupe) return NextResponse.json({ error: "EMAIL_TAKEN" }, { status: 409 });

  const tempPassword = crypto.randomBytes(12).toString("base64url");
  const passwordHash = await hashOwnerPassword(tempPassword);

  const user = await prisma.platformUser.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      role: parsed.data.role,
      passwordHash,
    },
  });

  await auditOwner({
    actorId: session.ownerId,
    action: "owner.team_invited",
    orgId: null,
    after: { id: user.id, email: user.email, role: user.role },
  });

  return NextResponse.json({
    ok: true,
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tempPassword,
  });
}

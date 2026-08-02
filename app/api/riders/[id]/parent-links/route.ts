import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { createParentLinkSchema } from "@/lib/schemas/parent-link";
import { userIsInForeignOrg } from "@/lib/authz-org";
import { centreFence } from "@/lib/authz-centre";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import crypto from "node:crypto";

// POST /api/riders/[id]/parent-links — attach a parent user to a rider.
// Caller needs rider.write (manager / head coach / super admin).
// Accepts either { parentUserId, relationship } or { parent: {...}, relationship } —
// the latter creates the User account inline and seeds a random password.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "rider.write")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const rider = await prisma.rider.findUnique({ where: { id: params.id }, select: { id: true, centreId: true } });
  if (!rider) return NextResponse.json({ error: "RIDER_NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence44 = await centreFence(session, rider.centreId);
  if (fence44) {
    return NextResponse.json({ error: fence44 }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createParentLinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // Resolve parent userId: either an existing one (must be role=PARENT) or freshly create one.
  let parentUserId: string;
  let tempPassword: string | undefined;
  if (d.parentUserId) {
    const u = await prisma.user.findUnique({ where: { id: d.parentUserId }, select: { id: true, role: true } });
    if (!u) return NextResponse.json({ error: "PARENT_USER_NOT_FOUND" }, { status: 404 });
    if (u.role !== "PARENT") return NextResponse.json({ error: "NOT_PARENT_ROLE" }, { status: 400 });
    // Don't let a parent already belonging to ANOTHER org be attached here.
    // An unlinked parent (no org yet) is fine — this link establishes it.
    if (await userIsInForeignOrg(session, u.id)) {
      return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
    }
    parentUserId = u.id;
  } else {
    // Inline create. Email must be unique — collisions are noisy but legitimate.
    const existing = await prisma.user.findUnique({ where: { email: d.parent!.email }, select: { id: true, role: true } });
    if (existing) {
      // If they already exist as a PARENT, reuse them — convenient for siblings.
      if (existing.role !== "PARENT") return NextResponse.json({ error: "EMAIL_TAKEN" }, { status: 409 });
      parentUserId = existing.id;
    } else {
      tempPassword = crypto.randomBytes(8).toString("base64url");
      const created = await prisma.user.create({
        data: {
          emailVerifiedAt: new Date(), // admin-created: the admin vouches for the address
          email: d.parent!.email,
          name: d.parent!.name,
          phone: d.parent!.phone ?? null,
          role: "PARENT",
          passwordHash: await hashPassword(tempPassword),
          centreId: null, // parents aren't centre-scoped; tenancy flows through the link
          mustChangePassword: true,
        },
      });
      parentUserId = created.id;
    }
  }

  // Dedup the link itself — unique constraint enforces it, but a friendlier error helps UI.
  const dupe = await prisma.parentLink.findUnique({
    where: { parentUserId_riderId: { parentUserId, riderId: rider.id } },
  });
  if (dupe) return NextResponse.json({ error: "ALREADY_LINKED" }, { status: 409 });

  const link = await prisma.parentLink.create({
    data: { parentUserId, riderId: rider.id, relationship: d.relationship },
  });

  await audit({
    userId: session.userId,
    action: "parent_link.create",
    tableName: "parentLink",
    rowId: link.id,
    after: { parentUserId, riderId: rider.id, relationship: d.relationship },
  });

  // Return the temp password ONCE so the manager can pass it to the parent. After this
  // response it's not retrievable — the parent will need to use a password reset flow.
  return NextResponse.json({ ok: true, linkId: link.id, parentUserId, tempPassword });
}

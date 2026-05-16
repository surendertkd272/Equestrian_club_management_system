import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";
import { forbidIfMissingOwnerPerm } from "@/lib/owner-permissions";
import { updateOwnerSchema } from "@/lib/schemas/platform-user";

// PATCH /api/owner/team/[id] — edit a platform user (name / role / status).
// Two lockout guards:
//   1. LAST_OWNER_ADMIN — refuse if this change would leave zero active OWNER_ADMINs.
//   2. CANNOT_DEMOTE_SELF — an actor can't strip their own ADMIN role
//      mid-session (would lock them out before they could fix it).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const block = forbidIfMissingOwnerPerm(session.role, "team.manage");
  if (block) return block;

  const body = await req.json().catch(() => null);
  const parsed = updateOwnerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "NO_CHANGES" }, { status: 400 });
  }

  const target = await prisma.platformUser.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const isSelf = target.id === session.ownerId;
  const demotingFromAdmin =
    target.role === "OWNER_ADMIN" && parsed.data.role && parsed.data.role !== "OWNER_ADMIN";
  const suspendingAdmin =
    target.role === "OWNER_ADMIN" && parsed.data.status === "suspended";

  // Self-demotion lockout guard.
  if (isSelf && (demotingFromAdmin || parsed.data.status === "suspended")) {
    return NextResponse.json({ error: "CANNOT_DEMOTE_SELF" }, { status: 409 });
  }

  // Last-admin guard. Run it whenever the change would remove a live admin —
  // either role demotion or suspension. We count active admins excluding the
  // target if its current state contributes to the count.
  if ((demotingFromAdmin || suspendingAdmin) && target.status === "active") {
    const otherActiveAdmins = await prisma.platformUser.count({
      where: { role: "OWNER_ADMIN", status: "active", NOT: { id: target.id } },
    });
    if (otherActiveAdmins === 0) {
      return NextResponse.json({ error: "LAST_OWNER_ADMIN" }, { status: 409 });
    }
  }

  const updated = await prisma.platformUser.update({
    where: { id: target.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.role !== undefined ? { role: parsed.data.role } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    },
  });

  await auditOwner({
    actorId: session.ownerId,
    action: "owner.team_updated",
    orgId: null,
    before: { name: target.name, role: target.role, status: target.status },
    after: { name: updated.name, role: updated.role, status: updated.status },
  });

  return NextResponse.json({ ok: true });
}

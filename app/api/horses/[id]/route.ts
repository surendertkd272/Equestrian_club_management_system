import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { updateHorseSchema } from "@/lib/schemas/horse";
import { audit } from "@/lib/audit";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import type { Prisma } from "@prisma/client";
import { horseUpdateData, describeHorseUpdate } from "@/lib/horse-writes";
import { CHANGE_KINDS, raiseChangeRequest, requiresApproval } from "@/lib/change-requests";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "horse.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = updateHorseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const horse = await prisma.horse.findUnique({ where: { id: params.id } });
  if (!horse) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role === "SUPER_ADMIN") {
    // Platform/HQ super-admin may edit any centre's horse — but only within
    // their own org, never another tenant's.
    const [callerOrg, rowOrg] = await Promise.all([
      getOrgIdForSession(session),
      getOrgIdForCentre(horse.centreId),
    ]);
    if (!callerOrg || callerOrg !== rowOrg) {
      return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
    }
  } else if (horse.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const d = parsed.data;

  // A head coach's edit to a horse's record becomes a request a manager
  // approves — see lib/change-requests.ts. Nothing changes on the horse until
  // then.
  if (requiresApproval(session.role)) {
    const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } });
    const request = await raiseChangeRequest({
      centreId: horse.centreId,
      kind: CHANGE_KINDS.HORSE_UPDATE,
      entityId: horse.id,
      title: `Horse change: ${horse.name}`,
      body: describeHorseUpdate(horse as unknown as Record<string, unknown>, d),
      payload: { data: d } as Prisma.InputJsonValue,
      requestedBy: session.userId,
      requesterName: me?.name ?? "A coach",
    });
    return NextResponse.json(
      { ok: true, pending: true, approvalId: request.id, message: "Sent to a manager for approval." },
      { status: 202 },
    );
  }

  const updated = await prisma.horse.update({ where: { id: horse.id }, data: horseUpdateData(d) });

  await audit({
    userId: session.userId,
    action: "update",
    tableName: "horse",
    rowId: horse.id,
    before: horse,
    after: updated,
  });

  return NextResponse.json({ ok: true });
}

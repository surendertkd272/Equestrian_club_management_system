import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";

// DELETE /api/riders/[id]/parent-links/[linkId] — unlink a parent from a rider.
// Doesn't delete the parent user itself; just removes the access grant.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; linkId: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "rider.write")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const link = await prisma.parentLink.findUnique({
    where: { id: params.linkId },
    include: { rider: { select: { centreId: true } } },
  });
  if (!link || link.riderId !== params.id) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && link.rider.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  await prisma.parentLink.delete({ where: { id: link.id } });
  await audit({
    userId: session.userId,
    action: "parent_link.delete",
    tableName: "parentLink",
    rowId: link.id,
    before: { parentUserId: link.parentUserId, riderId: link.riderId, relationship: link.relationship },
  });
  return NextResponse.json({ ok: true });
}

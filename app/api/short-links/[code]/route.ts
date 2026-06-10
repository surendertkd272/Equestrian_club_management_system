// Delete a generated short-link (the WhatsApp/Copy invites surface).
// Same permission set as POST in ../route.ts — SUPER_ADMIN, CENTRE_MANAGER,
// HEAD_COACH, STABLE_MANAGER. Centre-scoped: a manager at Centre A can't
// delete Centre B's links.
//
// Hard delete is fine here: ShortLink rows are convenience artefacts (a
// nicely-formatted URL the user pasted into WhatsApp), not records of
// regulated activity. The audit log keeps the deletion trace.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

function canManageLinks(role: string): boolean {
  return role === "SUPER_ADMIN"
    || role === "CENTRE_MANAGER"
    || role === "HEAD_COACH"
    || role === "STABLE_MANAGER";
}

export async function DELETE(_req: NextRequest, { params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canManageLinks(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const link = await prisma.shortLink.findUnique({ where: { code: params.code } });
  if (!link) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // Centre-scope guard. SUPER_ADMIN may cross centres but only within their own
  // org (C1); centre-scoped roles must own the link's centre.
  if (session.role === "SUPER_ADMIN") {
    const [callerOrg, linkOrg] = await Promise.all([
      getOrgIdForSession(session),
      getOrgIdForCentre(link.centreId),
    ]);
    if (!callerOrg || callerOrg !== linkOrg) {
      return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
    }
  } else if (link.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  await prisma.shortLink.delete({ where: { code: link.code } });
  await audit({
    userId: session.userId,
    action: "short_link.delete",
    tableName: "shortLink",
    rowId: link.id,
    before: { code: link.code, kind: link.kind, label: link.label, targetPath: link.targetPath },
  });
  return NextResponse.json({ ok: true });
}

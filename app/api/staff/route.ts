import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { hashPassword } from "@/lib/auth";
import { createStaffSchema } from "@/lib/schemas/staff";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createStaffSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // Resolve the target centre the same way every page does: centre-scoped
  // roles are pinned to their own centre; HQ (SUPER_ADMIN/ADMIN) follows the
  // top-bar centre picker via the ew_hq_centre cookie (scopeCentre), with an
  // explicit body.centreId as fallback. Previously this read only
  // session.centreId ?? body.centreId — HQ users always have centreId=null
  // and the form never sends one, so Add Staff 400'd for them regardless of
  // the picker.
  let centreId: string | null;
  try {
    centreId = scopeCentre(session);
  } catch {
    // Centre-less non-HQ user — no centre to attach staff to.
    return NextResponse.json({ error: "NO_CENTRE" }, { status: 400 });
  }
  centreId = centreId ?? (typeof body?.centreId === "string" && body.centreId ? body.centreId : null);
  if (!centreId) {
    return NextResponse.json(
      {
        error: "NO_CENTRE_SELECTED",
        message: "Pick a specific centre from the top-bar centre selector (not “All centres”), then try again.",
      },
      { status: 400 },
    );
  }

  // Cross-org guard: the picked/passed centre must belong to the caller's org
  // (covers a stale cookie or a hand-crafted body.centreId; also rejects a
  // nonexistent centre, for which getOrgIdForCentre returns null).
  const [callerOrg, centreOrg] = await Promise.all([
    getOrgIdForSession(session),
    getOrgIdForCentre(centreId),
  ]);
  if (!callerOrg || !centreOrg || callerOrg !== centreOrg) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
  }

  const existing = await prisma.user.findUnique({ where: { email: d.email } });
  if (existing) return NextResponse.json({ error: "EMAIL_IN_USE" }, { status: 409 });

  const passwordHash = await hashPassword(d.password);

  const user = await prisma.user.create({
    data: {
      email: d.email,
      name: d.name,
      phone: d.phone || null,
      role: d.role,
      centreId,
      passwordHash,
      status: "active",
    },
  });

  const staff = await prisma.staff.create({
    data: {
      centreId,
      userId: user.id,
      role: d.role,
      salaryBand: d.salaryBand || null,
      ...(d.joiningDate ? { joiningDate: new Date(d.joiningDate) } : {}),
      status: "active",
      aadhaarUrl: d.aadhaarUrl || null,
      policeVerificationUrl: d.policeVerificationUrl || null,
      policeVerifiedAt: d.policeVerificationUrl ? new Date() : null,
    },
  });

  await audit({
    userId: session.userId,
    action: "create",
    tableName: "staff",
    rowId: staff.id,
    after: { userId: user.id, role: d.role, name: d.name, email: d.email },
  });

  return NextResponse.json({ id: staff.id, userId: user.id });
}

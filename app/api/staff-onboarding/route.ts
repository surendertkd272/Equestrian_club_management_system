// Generate a shareable employee self-registration link. Admin picks the centre
// (HQ) or uses their own; we mint a tokenised draft EmployeeOnboarding the
// employee fills via /onboard/staff/<token>. Only the SHA-256 hash is stored.
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { audit } from "@/lib/audit";
import { generateOnboardingLinkSchema } from "@/lib/schemas/onboarding-staff";
import { hashOnboardingToken } from "@/lib/onboarding-token";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = generateOnboardingLinkSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  let centreId = scopeCentre(session);
  if (!centreId && isHQ && d.centreId) centreId = d.centreId;
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });
  const centre = await prisma.centre.findUnique({ where: { id: centreId }, select: { id: true, orgId: true } });
  if (!centre) return NextResponse.json({ error: "CENTRE_NOT_FOUND" }, { status: 400 });
  // Cross-org guard (C1): the centre (esp. an HQ body-supplied one) must belong
  // to the caller's org — otherwise HQ could mint an onboarding link into
  // another tenant's centre.
  const callerOrgId = await getOrgIdForSession(session);
  if (!callerOrgId || centre.orgId !== callerOrgId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
  }

  const plain = crypto.randomBytes(24).toString("base64url");
  const row = await prisma.employeeOnboarding.create({
    data: {
      centreId,
      tokenHash: hashOnboardingToken(plain),
      shareToken: plain, // lets the admin re-copy / re-share the link later
      expiresAt: new Date(Date.now() + d.expiresDays * 86_400_000),
      status: "draft",
      createdByUserId: session.userId,
      intendedRole: d.role ?? null, // pre-fills the role at approval (admin can override)
      reviewNotes: d.note ?? null, // admin's reference note (e.g. candidate name)
    },
  });

  await audit({
    userId: session.userId,
    action: "staff_onboarding.link_created",
    tableName: "employeeOnboarding",
    rowId: row.id,
  });

  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? new URL(req.url).origin;
  return NextResponse.json({ id: row.id, link: `${base}/onboard/staff/${plain}`, expiresAt: row.expiresAt });
}

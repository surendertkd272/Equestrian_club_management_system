import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createHorseSchema } from "@/lib/schemas/horse";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff, getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { scopeCentre } from "@/lib/tenancy";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "horse.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "horse-management");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createHorseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Resolve the target centre the same way every page does: centre-scoped
  // roles are pinned to their own centre; HQ (SUPER_ADMIN/ADMIN) follows the
  // top-bar centre picker via scopeCentre, with an explicit body.centreId as
  // fallback. Previously this read only session.centreId ?? body.centreId —
  // HQ users always have centreId=null and the form never sends one, so
  // adding a horse 400'd for them regardless of the picker. (Same fix as
  // Add Staff.)
  let centreId: string | null;
  try {
    centreId = scopeCentre(session);
  } catch {
    // Centre-less non-HQ user — no centre to attach the horse to.
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

  const horse = await prisma.horse.create({
    data: {
      centreId,
      name: parsed.data.name,
      breed: parsed.data.breed || null,
      sex: parsed.data.sex || null,
      dob: parsed.data.dob ? new Date(parsed.data.dob) : null,
      ageYears: parsed.data.ageYears ?? null,
      heightIn: parsed.data.heightIn ?? null,
      microchip: parsed.data.microchip || null,
      // EFI id + home club were captured by the form but silently dropped
      // here — persist them.
      efiHorseId: parsed.data.efiHorseId || null,
      homeClub: parsed.data.homeClub || null,
      ownership: parsed.data.ownership,
      stableNo: parsed.data.stableNo || null,
      diet: parsed.data.diet || null,
      insurerName: parsed.data.insurerName || null,
      insurancePolicyNo: parsed.data.insurancePolicyNo || null,
      insurancePremium: parsed.data.insurancePremium ?? null,
      insuranceValidFrom: parsed.data.insuranceValidFrom ? new Date(parsed.data.insuranceValidFrom) : null,
      insuranceValidTo: parsed.data.insuranceValidTo ? new Date(parsed.data.insuranceValidTo) : null,
    },
  });

  await audit({
    userId: session.userId,
    action: "create",
    tableName: "horse",
    rowId: horse.id,
    after: { name: horse.name, ownership: horse.ownership },
  });

  return NextResponse.json({ id: horse.id });
}

// PATCH /api/riders/[id] — edit a rider's core profile fields.
//
// Gates: rider.write (SUPER_ADMIN, ADMIN, CENTRE_MANAGER, HEAD_COACH).
// HQ admins (SUPER_ADMIN/ADMIN) can edit any centre's riders; centre-scoped
// roles are restricted to their own centre.
//
// Anthropometric edits (heightCm OR weightKg) trigger a server-side bmi
// recompute + bmiMeasuredAt bump, so the BMI banner + profile badge stay
// truthful without the client having to send the derived value.
//
// Out of scope (handled by dedicated routes): batch, parent-links,
// portal-access, skills, accreditations, indemnity/consent fields,
// status / approval workflow.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { calcBmi } from "@/lib/utils";
import { encryptPII, last4 } from "@/lib/pii";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { updateRiderSchema } from "@/lib/schemas/rider-update";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "rider.write")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const rider = await prisma.rider.findUnique({ where: { id: params.id } });
  if (!rider) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // Cross-centre block — HQ roles (SUPER_ADMIN, ADMIN) edit any centre's
  // rider, but ONLY within their own org; centre-scoped roles only edit their
  // own centre. (Previously HQ could edit any rider in any tenant.)
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (isHQ) {
    const [callerOrg, rowOrg] = await Promise.all([
      getOrgIdForSession(session),
      getOrgIdForCentre(rider.centreId),
    ]);
    if (!callerOrg || callerOrg !== rowOrg) {
      return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
    }
  } else if (rider.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateRiderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;

  // Build the update payload — only include keys the caller actually sent
  // so we don't clobber unrelated columns with undefined.
  const data: Record<string, unknown> = {};
  const editable = [
    "firstName", "lastName", "photoUrl", "placeOfBirth", "nationality",
    "gender", "maritalStatus", "aadhaarNo", "aadhaarDocUrl",
    "mobile", "email", "preferredLanguage", "school", "education", "occupation",
    "addressPresent", "addressPermanent", "pincode",
    "fatherName", "fatherPhone", "motherName", "motherPhone",
    "emergencyName", "emergencyPhone",
    "heightCm", "weightKg",
    "medicalNotes", "allergies", "currentLevel",
    "stateRiderId", "efiRiderId",
  ] as const;
  for (const k of editable) {
    if (k in d) data[k] = (d as Record<string, unknown>)[k];
  }
  // Aadhaar is encrypted at rest (lib/pii.ts). The form sends the plaintext
  // number (the edit page decrypts it for prefill); re-encrypt on write and
  // keep aadhaarLast4 in sync for masked display. The schema already
  // transforms "" → null, so d.aadhaarNo is a 12-digit string or null.
  if ("aadhaarNo" in d) {
    data.aadhaarNo = encryptPII(d.aadhaarNo ?? null);
    data.aadhaarLast4 = last4(d.aadhaarNo ?? null);
  }
  // dob is a Date column, but we ship YYYY-MM-DD on the wire.
  if ("dob" in d && d.dob) data.dob = new Date(d.dob);
  // joiningDate is likewise a Date column shipped as YYYY-MM-DD.
  if ("joiningDate" in d && d.joiningDate) data.joiningDate = new Date(d.joiningDate);

  // Recompute bmi when anthropometrics change. Use the post-update values
  // (incoming when present, prior row when not).
  if ("heightCm" in d || "weightKg" in d) {
    const newHeight = "heightCm" in d ? d.heightCm ?? null : rider.heightCm;
    const newWeight = "weightKg" in d ? d.weightKg ?? null : rider.weightKg;
    const newBmi = calcBmi(newHeight, newWeight);
    data.bmi = newBmi;
    data.bmiMeasuredAt = newBmi != null ? new Date() : null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, changed: 0 });
  }

  // Email uniqueness — User.email is @unique, but rider.email isn't. We
  // don't dedup that column. Aadhaar likewise has no DB-level unique; if
  // staff want it unique they enforce policy out of band.
  const updated = await prisma.rider.update({
    where: { id: rider.id },
    data,
  });

  // Audit log — diff against the prior row, only persisting changed keys
  // so the entry is compact and reviewer-friendly.
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of Object.keys(data)) {
    // Never persist the Aadhaar number (encrypted or not) into the audit log;
    // record only that it changed. aadhaarLast4 carries enough for review.
    if (k === "aadhaarNo") {
      before[k] = rider.aadhaarNo ? "[redacted]" : null;
      after[k] = updated.aadhaarNo ? "[redacted]" : null;
      continue;
    }
    before[k] = (rider as Record<string, unknown>)[k] ?? null;
    after[k] = (updated as Record<string, unknown>)[k] ?? null;
  }
  await audit({
    userId: session.userId,
    action: "rider.update",
    tableName: "rider",
    rowId: rider.id,
    before,
    after,
  });

  return NextResponse.json({ ok: true, id: rider.id });
}

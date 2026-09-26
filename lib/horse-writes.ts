import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import type { createHorseSchema, updateHorseSchema } from "@/lib/schemas/horse";

export type HorseCreateInput = z.infer<typeof createHorseSchema>;
export type HorseUpdateInput = z.infer<typeof updateHorseSchema>;

// The horse row mappings, shared by the horse routes and the approval flow so
// a change a manager approves is written by exactly the code that writes it
// when a manager makes it directly. Two copies of this mapping is how an
// approved edit quietly drops a field the route learned to persist later.

export function horseCreateData(d: HorseCreateInput, centreId: string): Prisma.HorseUncheckedCreateInput {
  return {
    centreId,
    name: d.name,
    breed: d.breed || null,
    sex: d.sex || null,
    dob: d.dob ? new Date(d.dob) : null,
    ageYears: d.ageYears ?? null,
    heightIn: d.heightIn ?? null,
    microchip: d.microchip || null,
    identificationMarks: d.identificationMarks,
    efiHorseId: d.efiHorseId || null,
    homeClub: d.homeClub || null,
    ownership: d.ownership,
    stableNo: d.stableNo || null,
    diet: d.diet || null,
    insurerName: d.insurerName || null,
    insurancePolicyNo: d.insurancePolicyNo || null,
    insurancePremium: d.insurancePremium ?? null,
    insuranceValidFrom: d.insuranceValidFrom ? new Date(d.insuranceValidFrom) : null,
    insuranceValidTo: d.insuranceValidTo ? new Date(d.insuranceValidTo) : null,
  };
}

export function horseUpdateData(d: HorseUpdateInput): Prisma.HorseUpdateInput {
  return {
    ...(d.name !== undefined ? { name: d.name } : {}),
    ...(d.breed !== undefined ? { breed: d.breed || null } : {}),
    ...(d.sex !== undefined ? { sex: d.sex || null } : {}),
    ...(d.dob !== undefined ? { dob: d.dob ? new Date(d.dob) : null } : {}),
    ...(d.ageYears !== undefined ? { ageYears: d.ageYears ?? null } : {}),
    ...(d.heightIn !== undefined ? { heightIn: d.heightIn ?? null } : {}),
    ...(d.microchip !== undefined ? { microchip: d.microchip || null } : {}),
    // No `|| null`: the schema's .min(1) refuses an empty string, so the only
    // way this key is present is a real value.
    ...(d.identificationMarks !== undefined ? { identificationMarks: d.identificationMarks } : {}),
    ...(d.efiHorseId !== undefined ? { efiHorseId: d.efiHorseId || null } : {}),
    ...(d.homeClub !== undefined ? { homeClub: d.homeClub || null } : {}),
    ...(d.ownership !== undefined ? { ownership: d.ownership } : {}),
    ...(d.stableNo !== undefined ? { stableNo: d.stableNo || null } : {}),
    ...(d.diet !== undefined ? { diet: d.diet || null } : {}),
    ...(d.status !== undefined ? { status: d.status } : {}),
    ...(d.insurerName !== undefined ? { insurerName: d.insurerName || null } : {}),
    ...(d.insurancePolicyNo !== undefined ? { insurancePolicyNo: d.insurancePolicyNo || null } : {}),
    ...(d.insurancePremium !== undefined ? { insurancePremium: d.insurancePremium ?? null } : {}),
    ...(d.insuranceValidFrom !== undefined
      ? { insuranceValidFrom: d.insuranceValidFrom ? new Date(d.insuranceValidFrom) : null }
      : {}),
    ...(d.insuranceValidTo !== undefined
      ? { insuranceValidTo: d.insuranceValidTo ? new Date(d.insuranceValidTo) : null }
      : {}),
  };
}

// "status active → rest, stable A1 → B2" — what the approver reads.
export function describeHorseUpdate(
  before: Record<string, unknown>,
  d: HorseUpdateInput,
): string {
  const changes: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    const prev = before[k];
    const show = (x: unknown) =>
      x instanceof Date ? x.toISOString().slice(0, 10) : x === null || x === undefined || x === "" ? "—" : String(x);
    if (show(prev) === show(v)) continue;
    changes.push(`${k} ${show(prev)} → ${show(v)}`);
  }
  return changes.length ? changes.join(", ") : "no field actually changes";
}

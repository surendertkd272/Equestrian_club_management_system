// One-shot (idempotent) backfill: encrypt existing plaintext Aadhaar numbers at
// rest and populate Rider.aadhaarLast4. Run ONCE per environment AFTER
// PII_ENCRYPTION_KEY has been provisioned (the same key everywhere that shares
// this database — see lib/pii.ts).
//
//   PII_ENCRYPTION_KEY=<base64-32-bytes> npx tsx scripts/backfill-aadhaar-encryption.ts
//
// Covers all three places an Aadhaar number lives:
//   1. Rider.aadhaarNo                  → encrypt + set aadhaarLast4
//   2. EmployeeOnboarding.aadhaarNumber → encrypt
//   3. Staff.kycDocsJson.aadhaarNumber  → encrypt the value inside the JSON blob
//
// Idempotent: values already carrying the "v1." prefix are left as-is (only
// aadhaarLast4 is repaired if missing). Re-running is a no-op.

import { PrismaClient } from "@prisma/client";
import { encryptPII, decryptPII, isEncryptedPII, last4 } from "../lib/pii";

const prisma = new PrismaClient();

// Resolve a value to plaintext whether it's currently encrypted or legacy plain.
function toPlain(stored: string): string {
  return isEncryptedPII(stored) ? (decryptPII(stored) ?? "") : stored;
}

async function backfillRiders() {
  const riders = await prisma.rider.findMany({
    where: { aadhaarNo: { not: null } },
    select: { id: true, aadhaarNo: true, aadhaarLast4: true },
  });
  let updated = 0;
  for (const r of riders) {
    const stored = r.aadhaarNo!;
    const plain = toPlain(stored);
    const enc = isEncryptedPII(stored) ? stored : encryptPII(plain)!;
    const l4 = last4(plain);
    if (enc !== stored || r.aadhaarLast4 !== l4) {
      await prisma.rider.update({ where: { id: r.id }, data: { aadhaarNo: enc, aadhaarLast4: l4 } });
      updated++;
    }
  }
  console.log(`Rider: ${riders.length} with Aadhaar, ${updated} updated.`);
}

async function backfillEmployeeOnboarding() {
  const rows = await prisma.employeeOnboarding.findMany({
    where: { aadhaarNumber: { not: null } },
    select: { id: true, aadhaarNumber: true },
  });
  let updated = 0;
  for (const ob of rows) {
    if (isEncryptedPII(ob.aadhaarNumber!)) continue;
    await prisma.employeeOnboarding.update({
      where: { id: ob.id },
      data: { aadhaarNumber: encryptPII(ob.aadhaarNumber) },
    });
    updated++;
  }
  console.log(`EmployeeOnboarding: ${rows.length} with Aadhaar, ${updated} updated.`);
}

async function backfillStaffKyc() {
  const staff = await prisma.staff.findMany({
    where: { kycDocsJson: { not: null } },
    select: { id: true, kycDocsJson: true },
  });
  let updated = 0;
  for (const s of staff) {
    let kyc: Record<string, unknown>;
    try {
      kyc = JSON.parse(s.kycDocsJson as string);
    } catch {
      continue; // not JSON — skip
    }
    const a = kyc.aadhaarNumber;
    if (typeof a !== "string" || a === "" || isEncryptedPII(a)) continue;
    kyc.aadhaarNumber = encryptPII(a);
    await prisma.staff.update({ where: { id: s.id }, data: { kycDocsJson: JSON.stringify(kyc) } });
    updated++;
  }
  console.log(`Staff.kycDocsJson: ${staff.length} scanned, ${updated} updated.`);
}

async function main() {
  if (!process.env.PII_ENCRYPTION_KEY) {
    throw new Error(
      "PII_ENCRYPTION_KEY is not set. Refusing to run — backfilling without a key would " +
        "store plaintext. Generate one (openssl rand -base64 32), set it in every environment " +
        "sharing this database, then re-run.",
    );
  }
  console.log("Backfilling Aadhaar encryption at rest…\n");
  await backfillRiders();
  await backfillEmployeeOnboarding();
  await backfillStaffKyc();
  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

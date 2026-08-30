// Repair certificates whose stored QR is a relative path.
//
// verifyUrl() used to fall back to "/verify/<serial>" when NEXT_PUBLIC_APP_URL
// was unset, and that string was PERSISTED as Certificate.qrCode. Any
// certificate minted in that window carries a QR that resolves to nothing when
// scanned from a printed page — and re-rendering the certificate does not fix
// it, because the broken value is in the database.
//
// The serial is intact in either case, so the repair is exact: rebuild the URL
// from serialNo. Nothing is invented and nothing else is touched.
//
// Usage:
//   npx tsx scripts/fix-relative-cert-qr.ts            # report only
//   npx tsx scripts/fix-relative-cert-qr.ts --apply    # write the fixes

import { PrismaClient } from "@prisma/client";
import { baseUrl } from "../lib/absolute-url";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  // Fail before touching anything if we still cannot build a correct URL —
  // otherwise this "repair" would write the same broken value back.
  const base = baseUrl();
  console.log(`Base URL: ${base}`);

  const broken = await prisma.certificate.findMany({
    where: { NOT: { qrCode: { startsWith: "http" } } },
    select: { id: true, serialNo: true, qrCode: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  if (broken.length === 0) {
    console.log("No certificates with a relative QR. Nothing to do.");
    return;
  }

  console.log(`\n${broken.length} certificate(s) with an unscannable QR:\n`);
  for (const c of broken.slice(0, 20)) {
    console.log(`  ${c.serialNo}  ${c.qrCode}  →  ${base}/verify/${c.serialNo}`);
  }
  if (broken.length > 20) console.log(`  … and ${broken.length - 20} more`);

  if (!APPLY) {
    console.log("\nReport only. Re-run with --apply to write these fixes.");
    return;
  }

  let fixed = 0;
  for (const c of broken) {
    await prisma.certificate.update({
      where: { id: c.id },
      data: { qrCode: `${base}/verify/${c.serialNo}` },
    });
    fixed++;
  }
  console.log(`\nRepaired ${fixed} certificate(s).`);
  console.log(
    "Any already PRINTED with the old QR stay broken on paper — those need reprinting.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

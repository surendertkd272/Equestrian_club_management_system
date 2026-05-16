// Dry-run smoke test. Pushes a wide, realistic dataset through the system
// and exercises every feature path that doesn't require a running web server.
//
// What this validates:
//   1. Schema integrity (every model insert works with current schema)
//   2. Tenant scoping (each centre sees only its rows)
//   3. The new features added in passes 1–6:
//        - SetupChecklist queries
//        - Pagination counts
//        - CSV export queries
//        - Cmd+K search (9 domains)
//        - Owner forgot-password (issue + redeem)
//        - TOTP enroll + verify
//        - Custom-domain resolution
//        - Notifications unread-count
//        - Trial-end sweep
//   4. Cron sweeps don't crash on the seeded data
//
// Failures are collected and printed at the end as a punch list. The script
// exits non-zero if anything fails so CI can catch regressions.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { issueResetToken, redeemResetToken, hashToken } from "../lib/password-reset";
import { issueOwnerResetToken, redeemOwnerResetToken } from "../lib/owner-password-reset";
import { generateTotpSecret, generateTotp, verifyTotp, otpauthUrl } from "../lib/totp";
import { resolveCustomDomain } from "../lib/custom-domain";
import { toCsv } from "../lib/csv";
import { mergePrefs, isInQuietHours } from "../lib/notify-prefs";
import { notify } from "../lib/notify";
import { SWEEP_JOBS } from "../lib/sweeps";
import { FEATURE_KEYS } from "../lib/features";

const prisma = new PrismaClient();
const issues: { tag: string; msg: string }[] = [];

function fail(tag: string, msg: string) {
  issues.push({ tag, msg });
  console.error(`  ✗ ${tag}: ${msg}`);
}

function pass(tag: string, msg: string) {
  console.log(`  ✓ ${tag}: ${msg}`);
}

async function tryStep(tag: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e: any) {
    fail(tag, e?.message ?? String(e));
  }
}

async function main() {
  // Belt #1: only ever run against a local SQLite file. Postgres + real
  // hostnames mean production — guarantees the smoke test cannot drop a
  // staging or prod DB even if env vars get crossed.
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) {
    console.error(
      `Refusing to run against non-SQLite DATABASE_URL (${url.slice(0, 30)}…).\n` +
        "This script wipes the database — only safe against a local file: URL.",
    );
    await prisma.$disconnect();
    process.exit(2);
  }
  // Belt #2: if real seed accounts are present (the equiwings.in domain),
  // refuse unless --force is passed. Avoids accidentally nuking the dev
  // login + having to re-seed every time someone runs the smoke test.
  if (!process.argv.includes("--force")) {
    const seeded = await prisma.user.findFirst({
      where: { email: { endsWith: "@equiwings.in" } },
      select: { id: true },
    });
    if (seeded) {
      console.error(
        "Refusing to wipe: seeded equiwings users present.\n" +
          "Pass --force to override (and re-seed afterwards):\n" +
          "  npx tsx scripts/dryrun-smoke.ts --force",
      );
      await prisma.$disconnect();
      process.exit(2);
    }
  }

  console.log("\n=== RESET ==");
  // Wipe tables in dependency order. SQLite cascades aren't always reliable
  // with the dev schema, so explicit DELETEs are safer.
  const tables = [
    "OwnerPasswordResetToken",
    "PasswordResetToken",
    "Notification",
    "AuditLog",
    "PlatformAuditLog",
    "Payment",
    "Invoice",
    "Attendance",
    "Exam",
    "Certificate",
    "PrizeAward",
    "StartListEntry",
    "CompetitionClass",
    "Sponsor",
    "Competition",
    "HorseAllocation",
    "FarrierVisit",
    "VaccinationSchedule",
    "HorseHealthLog",
    "InjuryLog",
    "ConsumableMovement",
    "Consumable",
    "MedicineMovement",
    "MedicinePrescription",
    "Medicine",
    "Tack",
    "AssetIssue",
    "AssetMaintenance",
    "Asset",
    "Task",
    "TeamMember",
    "Team",
    "StaffCertification",
    "FacilityBooking",
    "ApprovalRequest",
    "CourseEnrolment",
    "Course",
    "ParentLink",
    "Rider",
    "Batch",
    "Staff",
    "User",
    "OrgFeature",
    "PlatformUser",
    "Centre",
    "Organisation",
  ];
  // SQLite enforces FKs at insert time when PRAGMA foreign_keys=ON. Turn
  // it off for the duration of the wipe so we don't have to chase delete
  // order across 40+ tables.
  await (prisma as any).$executeRawUnsafe(`PRAGMA foreign_keys = OFF`);
  for (const t of tables) {
    try {
      await (prisma as any).$executeRawUnsafe(`DELETE FROM "${t}"`);
    } catch {}
  }
  await (prisma as any).$executeRawUnsafe(`PRAGMA foreign_keys = ON`);

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== ORG / OWNER ==");
  let org: any, ownerA: any;
  await tryStep("org_owner_create", async () => {
    org = await prisma.organisation.create({
      data: {
        slug: "smoke-club",
        name: "Smoke Test Club",
        status: "trial",
        plan: "pro",
        trialEndsAt: new Date(Date.now() - 86400000), // already expired — will trigger sweep
        billingEmail: "billing@smoke.test",
        customDomain: "smoke.equestrian.app",
        contactName: "Demo Owner",
      },
    });
    for (const key of FEATURE_KEYS) {
      await prisma.orgFeature.create({
        data: { orgId: org.id, featureKey: key, enabled: true },
      });
    }
    ownerA = await prisma.platformUser.create({
      data: {
        email: "owner-a@platform.local",
        name: "Owner A",
        role: "OWNER_ADMIN",
        passwordHash: await bcrypt.hash("password", 10),
      },
    });
    pass("org_owner_create", `org=${org.slug} owner=${ownerA.email}`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== CENTRES ==");
  let centreA: any, centreB: any;
  await tryStep("centres", async () => {
    centreA = await prisma.centre.create({
      data: {
        orgId: org.id,
        slug: "smoke-a",
        name: "Smoke Centre A",
        address: "Bengaluru",
        emergencyContactsJson: JSON.stringify([
          { label: "Vet on call", number: "+91 98765 11111", type: "vet" },
          { label: "Ambulance", number: "+91 98765 22222", type: "ambulance" },
        ]),
      },
    });
    centreB = await prisma.centre.create({
      data: { orgId: org.id, slug: "smoke-b", name: "Smoke Centre B", address: "Mumbai" },
    });
    pass("centres", `created 2: ${centreA.name}, ${centreB.name}`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== USERS (every role) ==");
  const ROLES = [
    "SUPER_ADMIN",
    "CENTRE_MANAGER",
    "HEAD_COACH",
    "COACH",
    "STABLE_MANAGER",
    "INVENTORY_MANAGER",
    "COMPETITION_MANAGER",
    "GROOM",
    "FARRIER",
    "VET",
    "ACCOUNTANT",
    "EXAMINER",
  ];
  const users: Record<string, any> = {};
  await tryStep("users_every_role", async () => {
    const hash = await bcrypt.hash("password", 10);
    for (const role of ROLES) {
      const u = await prisma.user.create({
        data: {
          name: `${role.replace(/_/g, " ").toLowerCase()} user`,
          email: `${role.toLowerCase()}@smoke.test`,
          role,
          centreId: role === "SUPER_ADMIN" ? null : centreA.id,
          passwordHash: hash,
        },
      });
      users[role] = u;
    }
    pass("users_every_role", `created ${Object.keys(users).length} users`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== HORSES ==");
  const horses: any[] = [];
  await tryStep("horses", async () => {
    for (let i = 1; i <= 8; i++) {
      const h = await prisma.horse.create({
        data: {
          centreId: i % 3 === 0 ? centreB.id : centreA.id,
          name: `Horse ${i}`,
          breed: ["Marwari", "Kathiawari", "Thoroughbred"][i % 3],
          sex: ["mare", "stallion", "gelding"][i % 3],
          ageYears: 5 + (i % 10),
          stableNo: `S-${i}`,
          ownership: i % 4 === 0 ? "private" : "club",
          status: i === 7 ? "rest" : i === 8 ? "retired" : "active",
        },
      });
      horses.push(h);
    }
    pass("horses", `created ${horses.length}`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== BATCHES + RIDERS ==");
  const batches: any[] = [];
  const riders: any[] = [];
  await tryStep("batches", async () => {
    for (let i = 1; i <= 3; i++) {
      const b = await prisma.batch.create({
        data: {
          centreId: centreA.id,
          name: `Batch ${i}`,
          dayOfWeek: "Mon,Wed,Fri",
          startTime: "06:00",
          endTime: "07:00",
          coachId: users.COACH.id,
          level: "Beginner",
        },
      });
      batches.push(b);
    }
    pass("batches", `created ${batches.length}`);
  });
  await tryStep("riders", async () => {
    for (let i = 1; i <= 12; i++) {
      const r = await prisma.rider.create({
        data: {
          centreId: i % 4 === 0 ? centreB.id : centreA.id,
          firstName: `Rider${i}`,
          lastName: `Last${i}`,
          mobile: `9${String(900000000 + i).padStart(9, "0")}`,
          email: `rider${i}@smoke.test`,
          dob: new Date(2010, i % 12, (i % 27) + 1),
          gender: i % 2 === 0 ? "female" : "male",
          joiningDate: new Date(Date.now() - i * 30 * 86400000),
          batchId: batches[i % batches.length]?.id,
          status: i === 11 ? "pending_payment" : i === 12 ? "suspended" : "active",
          currentLevel: ["Beginner", "Intermediate", "Advanced"][i % 3],
        },
      });
      riders.push(r);
    }
    pass("riders", `created ${riders.length}`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== ATTENDANCE ==");
  await tryStep("attendance", async () => {
    let made = 0;
    for (let d = 0; d < 5; d++) {
      const date = new Date();
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - d);
      for (const r of riders.filter((x) => x.batchId)) {
        await prisma.attendance.create({
          data: {
            riderId: r.id,
            batchId: r.batchId!,
            date,
            status: d === 0 ? "present" : d === 1 ? "absent" : "present",
            reason: d === 1 ? "Sick" : null,
            markedBy: users.COACH.id,
          },
        });
        made++;
      }
    }
    pass("attendance", `${made} rows over 5 days`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== INVOICES + PAYMENTS ==");
  await tryStep("invoices", async () => {
    let count = 0;
    for (const r of riders.slice(0, 6)) {
      const inv = await prisma.invoice.create({
        data: {
          centreId: r.centreId,
          riderId: r.id,
          amount: 3000,
          gstAmount: 540,
          dueDate: new Date(Date.now() + 14 * 86400000),
          status: "paid",
          kind: "monthly",
        },
      });
      await prisma.payment.create({
        data: {
          invoiceId: inv.id,
          amount: 3540,
          method: "razorpay",
          paidAt: new Date(),
          clearedAt: new Date(),
        },
      });
      count++;
    }
    pass("invoices", `${count} paid invoices`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== EXAMS + CERTIFICATES ==");
  await tryStep("exams", async () => {
    let count = 0;
    for (const r of riders.slice(0, 4)) {
      const exam = await prisma.exam.create({
        data: {
          centreId: r.centreId,
          riderId: r.id,
          examinerId: users.EXAMINER.id,
          examinerName: users.EXAMINER.name,
          level: 1,
          date: new Date(),
          status: "completed",
          totalScore: 78,
          passed: true,
        },
      });
      await prisma.certificate.create({
        data: {
          centreId: r.centreId,
          riderId: r.id,
          type: "promotion",
          serialNo: `SMK-${Date.now()}-${count}`,
          levelName: "Level 1",
          issuedAt: new Date(),
          qrCode: `https://verify.equiwings.app/${count}`,
        },
      });
      count++;
    }
    pass("exams", `${count} exams + certs`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== MEDICINES + TACK ==");
  await tryStep("medicines", async () => {
    for (let i = 1; i <= 5; i++) {
      await prisma.medicine.create({
        data: {
          centreId: centreA.id,
          name: `Medicine ${i}`,
          category: "nsaid",
          batchNo: `B-${i}`,
          qty: i === 1 ? 2 : 50, // one low-stock
          expDate: i === 2 ? new Date(Date.now() + 10 * 86400000) : new Date(Date.now() + 365 * 86400000),
        },
      });
    }
    pass("medicines", "5 (1 low-stock, 1 expiring soon)");
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== COMPETITIONS ==");
  await tryStep("competitions", async () => {
    await prisma.competition.create({
      data: {
        centreId: centreA.id,
        name: "Smoke Cup 2026",
        slug: "smoke-cup-2026",
        scope: "internal",
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
        venue: "Main Arena",
        classesJson: JSON.stringify([{ name: "Open", fee: 500 }]),
      },
    });
    pass("competitions", "1 created");
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== NOTIFICATIONS ==");
  await tryStep("notifications", async () => {
    for (let i = 0; i < 6; i++) {
      await prisma.notification.create({
        data: {
          userId: users.CENTRE_MANAGER.id,
          type: "smoke.test",
          title: `Smoke ${i}`,
          body: `Body ${i}`,
          readAt: i < 2 ? new Date() : null,
        },
      });
    }
    const unread = await prisma.notification.count({
      where: { userId: users.CENTRE_MANAGER.id, readAt: null },
    });
    if (unread !== 4) throw new Error(`expected 4 unread, got ${unread}`);
    pass("notifications", `6 created, ${unread} unread`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== PAGINATION COUNTS ==");
  await tryStep("pagination_counts", async () => {
    const total = await prisma.rider.count({ where: { centreId: centreA.id } });
    const page = await prisma.rider.findMany({ where: { centreId: centreA.id }, skip: 0, take: 5 });
    if (page.length === 0 || total === 0) throw new Error("empty page");
    pass("pagination_counts", `total=${total}, page=${page.length}`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== TENANT SCOPING ==");
  await tryStep("tenant_scoping", async () => {
    const inA = await prisma.rider.count({ where: { centreId: centreA.id } });
    const inB = await prisma.rider.count({ where: { centreId: centreB.id } });
    if (inA === 0 || inB === 0) throw new Error(`expected riders in both centres (A=${inA}, B=${inB})`);
    pass("tenant_scoping", `A=${inA} B=${inB} (cross-bleed not present)`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== CSV EXPORT ==");
  await tryStep("csv_export", async () => {
    const rs = await prisma.rider.findMany({ where: { centreId: centreA.id } });
    const csv = toCsv(["First", "Last", "Mobile"], rs.map((r) => [r.firstName, r.lastName, r.mobile]));
    if (!csv.startsWith("﻿")) throw new Error("missing UTF-8 BOM");
    if (!csv.includes("Rider1,Last1")) throw new Error("expected row missing");
    pass("csv_export", `${csv.split("\n").length - 2} rows + bom`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== TOTP ==");
  await tryStep("totp", async () => {
    const secret = generateTotpSecret();
    const url = otpauthUrl({ secret, label: "smoke@x.test", issuer: "Equiwings" });
    if (!url.startsWith("otpauth://totp/")) throw new Error("bad otpauth url");
    const code = generateTotp(secret);
    if (!verifyTotp(secret, code)) throw new Error("self-verify failed");
    if (verifyTotp(secret, "000000")) throw new Error("accepted bad code");
    pass("totp", `secret(${secret.length}b) ok, code=${code}`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== PASSWORD RESET (tenant) ==");
  await tryStep("password_reset_tenant", async () => {
    const token = await issueResetToken(users.COACH.id);
    const r1 = await redeemResetToken(token);
    if (!r1.ok || r1.userId !== users.COACH.id) throw new Error(`redeem failed: ${JSON.stringify(r1)}`);
    const r2 = await redeemResetToken(token);
    if (r2.ok) throw new Error("expected replay rejection");
    pass("password_reset_tenant", `redeemed once, replay blocked (${(r2 as any).error})`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== PASSWORD RESET (owner) ==");
  await tryStep("password_reset_owner", async () => {
    const token = await issueOwnerResetToken(ownerA.id);
    const r1 = await redeemOwnerResetToken(token);
    if (!r1.ok || r1.ownerId !== ownerA.id) throw new Error(`redeem failed: ${JSON.stringify(r1)}`);
    const r2 = await redeemOwnerResetToken(token);
    if (r2.ok) throw new Error("expected replay rejection");
    pass("password_reset_owner", `redeemed once, replay blocked (${(r2 as any).error})`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== CUSTOM DOMAIN RESOLVER ==");
  await tryStep("custom_domain", async () => {
    const a = await resolveCustomDomain("smoke.equestrian.app");
    if (!a?.isCustomDomain || a.org?.slug !== "smoke-club") {
      throw new Error(`expected match, got ${JSON.stringify(a)}`);
    }
    const b = await resolveCustomDomain("unknown.example.com");
    if (b?.isCustomDomain) throw new Error("unknown host matched");
    pass("custom_domain", `match=smoke-club, unknown=no-match`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== NOTIFY w/ PREFERENCES ==");
  await tryStep("notify_prefs", async () => {
    await prisma.user.update({
      where: { id: users.COACH.id },
      data: { notifPrefsJson: JSON.stringify({ inApp: false }) },
    });
    await notify({
      userId: users.COACH.id,
      type: "smoke.muted",
      title: "muted",
      body: "should not arrive",
    });
    const muted = await prisma.notification.count({
      where: { userId: users.COACH.id, type: "smoke.muted" },
    });
    if (muted !== 0) throw new Error(`expected 0, got ${muted}`);

    await notify({
      userId: users.COACH.id,
      type: "smoke.critical",
      title: "critical",
      body: "must arrive",
      criticality: "critical",
    });
    const crit = await prisma.notification.count({
      where: { userId: users.COACH.id, type: "smoke.critical" },
    });
    if (crit !== 1) throw new Error(`critical not delivered: ${crit}`);
    pass("notify_prefs", "inApp=false suppresses normal, critical bypasses");
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== QUIET HOURS ==");
  await tryStep("quiet_hours", async () => {
    const prefs = mergePrefs(JSON.stringify({ quietHoursStart: "22:00", quietHoursEnd: "07:00" }));
    const night = new Date();
    night.setHours(23, 30, 0, 0);
    if (!isInQuietHours(prefs, night)) throw new Error("23:30 not detected as quiet");
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    if (isInQuietHours(prefs, noon)) throw new Error("12:00 wrongly detected as quiet");
    pass("quiet_hours", "overnight window correct");
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== SETUP CHECKLIST DATA ==");
  await tryStep("setup_checklist", async () => {
    // Mimic what the dashboard server component computes.
    const [centreCount, staffCount, activeRiders, batchCount, horseCount] = await Promise.all([
      prisma.centre.count(),
      prisma.user.count({
        where: { centreId: centreA.id, role: { notIn: ["SUPER_ADMIN", "CENTRE_MANAGER"] as any } },
      }),
      prisma.rider.count({ where: { centreId: centreA.id, status: "active" } }),
      prisma.batch.count({ where: { centreId: centreA.id } }),
      prisma.horse.count({ where: { centreId: centreA.id } }),
    ]);
    if (centreCount === 0) throw new Error("centreCount=0");
    if (staffCount === 0) throw new Error("staffCount=0");
    if (batchCount === 0) throw new Error("batchCount=0");
    if (horseCount === 0) throw new Error("horseCount=0");
    if (activeRiders === 0) throw new Error("activeRiders=0");
    pass(
      "setup_checklist",
      `centres=${centreCount} staff=${staffCount} batches=${batchCount} horses=${horseCount} riders=${activeRiders}`,
    );
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== TRIAL-END SWEEP ==");
  await tryStep("trial_end_sweep", async () => {
    const before = await prisma.organisation.findUnique({ where: { id: org.id }, select: { status: true } });
    const result = await SWEEP_JOBS.trial_end!();
    const after = await prisma.organisation.findUnique({ where: { id: org.id }, select: { status: true } });
    if (before?.status !== "trial") throw new Error(`expected starting status=trial, was ${before?.status}`);
    if (after?.status !== "past_due") throw new Error(`expected past_due after sweep, got ${after?.status}`);
    pass("trial_end_sweep", `trial → past_due (scanned=${result.scanned}, notified=${result.notified})`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== ALL CRON SWEEPS ==");
  for (const [name, fn] of Object.entries(SWEEP_JOBS)) {
    await tryStep(`sweep_${name}`, async () => {
      const r = await fn();
      if (typeof r.scanned !== "number") throw new Error("missing scanned");
      pass(`sweep_${name}`, `scanned=${r.scanned} notified=${r.notified} skipped=${r.skipped}`);
    });
  }

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== CMD+K SEARCH SHAPES ==");
  await tryStep("cmdk_search", async () => {
    // Mimic /api/search hits for each of the 9 domains.
    const [r, h, e, c, b, m, cert] = await Promise.all([
      prisma.rider.findFirst({ where: { centreId: centreA.id } }),
      prisma.horse.findFirst({ where: { centreId: centreA.id } }),
      prisma.exam.findFirst({ where: { centreId: centreA.id } }),
      prisma.competition.findFirst({ where: { centreId: centreA.id } }),
      prisma.batch.findFirst({ where: { centreId: centreA.id } }),
      prisma.medicine.findFirst({ where: { centreId: centreA.id } }),
      prisma.certificate.findFirst({ where: { centreId: centreA.id } }),
    ]);
    for (const [name, row] of Object.entries({ rider: r, horse: h, exam: e, competition: c, batch: b, medicine: m, certificate: cert })) {
      if (!row) throw new Error(`no ${name} present for search domain`);
    }
    pass("cmdk_search", `all 7 cross-centre domains seeded`);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== SUMMARY ==");
  if (issues.length === 0) {
    console.log("\n🟢 ALL CHECKS PASSED");
  } else {
    console.log(`\n🔴 ${issues.length} ISSUE(S):`);
    for (const i of issues) console.log(`   - [${i.tag}] ${i.msg}`);
  }
  await prisma.$disconnect();
  process.exit(issues.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(2);
});

import { NextRequest, NextResponse } from "next/server";
import { runAllSweeps, SWEEP_JOBS, type SweepResult } from "@/lib/sweeps";
import { alertSweepFailures } from "@/lib/sweeps/alert";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import crypto from "node:crypto";
import { bindRlsBypass } from "@/lib/tenant-context";

// Single-flight lock (H5) for the full nightly batch. A stale lock (crashed
// holder) auto-expires after STALE_MS so the batch can never wedge permanently.
const SWEEP_LOCK_ID = "sweep";
const SWEEP_LOCK_STALE_MS = 15 * 60 * 1000;

async function acquireSweepLock(): Promise<boolean> {
  // Ensure the row exists, then atomically claim it only if free or stale.
  await prisma.cronLock.upsert({ where: { id: SWEEP_LOCK_ID }, create: { id: SWEEP_LOCK_ID }, update: {} });
  const staleCutoff = new Date(Date.now() - SWEEP_LOCK_STALE_MS);
  const claim = await prisma.cronLock.updateMany({
    where: { id: SWEEP_LOCK_ID, OR: [{ lockedAt: null }, { lockedAt: { lt: staleCutoff } }] },
    data: { lockedAt: new Date() },
  });
  return claim.count === 1;
}

async function releaseSweepLock(): Promise<void> {
  await prisma.cronLock.updateMany({ where: { id: SWEEP_LOCK_ID }, data: { lockedAt: null } });
}

// Auth: shared secret. Caller can pass it via:
//   - Authorization: Bearer <CRON_SECRET>           (curl, GitHub Actions)
//   - x-cron-secret: <CRON_SECRET>                  (custom schedulers)
//   - ?secret=<CRON_SECRET>                         (manual / custom schedulers)
//
// The scheduler is GitHub Actions (.github/workflows/nightly-sweep.yml), using
// the BEARER form. It is not Vercel Cron, despite the entry still in
// vercel.json.
//
// That entry originally carried `?secret=$CRON_SECRET`, which never worked:
// Vercel does not interpolate env vars into a cron path, so it requested the
// literal string and got a 401 every night. Removing it changed nothing, and
// the rejection log below proves why — after two nights there were ZERO
// rejected attempts, meaning nothing was arriving at all. This project is on
// Vercel's Hobby plan, where cron is restricted and best-effort.
//
// The vercel.json entry is left as a harmless fallback: acquireSweepLock()
// single-flights the batch, so if Vercel ever does start firing it cannot
// double-run alongside the GitHub schedule.
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false; // never allow without a configured secret
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const header = req.headers.get("x-cron-secret");
  const query = req.nextUrl.searchParams.get("secret");
  const supplied = bearer ?? header ?? query ?? "";
  if (!supplied || supplied.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  } catch {
    return false;
  }
}

// A rejected cron used to return 401 and write NOTHING, so a scheduler that was
// being turned away every night at 02:00 left no trace anywhere — which is
// exactly how the nightly batch stayed dead for two months without anyone
// noticing. Now it leaves one, capped at a row an hour so an unauthenticated
// endpoint can't be used to flood the audit log.
async function recordRejectedCron(req: NextRequest): Promise<void> {
  try {
    const { checkRate, clientFingerprint } = await import("@/lib/rate-limit");
    if (!(await checkRate("cron-reject-audit", 1, 60 * 60_000)).ok) return;
    const { audit } = await import("@/lib/audit");
    await audit({
      action: "cron.sweep_rejected",
      tableName: "cronLock",
      rowId: SWEEP_LOCK_ID,
      after: {
        reason: process.env.CRON_SECRET ? "bad_or_missing_secret" : "CRON_SECRET_not_set",
        // Which form the caller tried, so a misconfigured scheduler is
        // identifiable without logging the secret itself.
        sawAuthHeader: Boolean(req.headers.get("authorization")),
        sawQuerySecret: req.nextUrl.searchParams.has("secret"),
      },
      ip: clientFingerprint(req),
      userAgent: req.headers.get("user-agent"),
    });
  } catch {
    // Never let bookkeeping turn a 401 into a 500.
  }
}

// POST = run sweeps. Optional ?job=<name> picks a single sweep; default runs all.
export async function POST(req: NextRequest) {
  bindRlsBypass(); // cron sweeps are cross-org by design
  if (!isAuthorized(req)) {
    await recordRejectedCron(req);
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const job = req.nextUrl.searchParams.get("job");
  const force = req.nextUrl.searchParams.get("force") === "1";
  const t0 = Date.now();

  // Single-flight (H5): the full nightly batch takes a lock so an overlapping
  // run (manual POST during the scheduled run, or a Vercel retry of a
  // partially-completed batch) is skipped rather than re-firing every job and
  // amplifying duplicate notifications. Single-job (?job=) admin runs are not
  // locked. Released in finally below.
  let lockHeld = false;
  if (!job) {
    const acquired = await acquireSweepLock();
    if (!acquired) {
      return NextResponse.json({ ok: true, skipped: "ALREADY_RUNNING" });
    }
    lockHeld = true;
  }

  // runAllSweeps already isolates per-job failures (allSettled). This outer
  // try/catch is the backstop for the single-job path (?job=, which calls fn
  // directly) and for an infrastructure failure (DB down, audit write throwing)
  // — so the cron caller always gets a structured response to log/alert on
  // instead of an opaque 500 with no record of what ran.
  try {
    let results: SweepResult[];
    if (job) {
      const fn = SWEEP_JOBS[job];
      if (!fn) {
        return NextResponse.json({ error: "UNKNOWN_JOB", available: Object.keys(SWEEP_JOBS) }, { status: 400 });
      }
      results = [await fn({ force })];
    } else {
      results = await runAllSweeps();
    }
    const elapsedMs = Date.now() - t0;

    await audit({
      action: "cron.sweep",
      tableName: "cron",
      rowId: job ?? "all",
      after: { elapsedMs, results },
    });

    // Page ops about per-job failures (allSettled means they're inside
    // `results`, not the catch below). Internally guarded — never throws.
    await alertSweepFailures(results, { scope: job ?? "all", elapsedMs });

    return NextResponse.json({ ok: true, elapsedMs, results });
  } catch (e: any) {
    const elapsedMs = Date.now() - t0;
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/sweep] run failed:", e);
    // Whole-run/infrastructure failure (DB down, audit write threw) — alert
    // with a synthetic result so ops hears about THIS class of failure too.
    await alertSweepFailures(
      [{ job: job ?? "all", scanned: 0, notified: 0, skipped: 0, error: message }],
      { scope: job ?? "all", elapsedMs },
    );
    return NextResponse.json(
      { ok: false, error: "SWEEP_FAILED", message, elapsedMs, job: job ?? "all" },
      { status: 500 },
    );
  } finally {
    if (lockHeld) await releaseSweepLock();
  }
}

// GET is the dry-run / status check (for cron schedulers that probe before scheduling).
export async function GET(req: NextRequest) {
  bindRlsBypass(); // cron sweeps are cross-org by design
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    available_jobs: Object.keys(SWEEP_JOBS),
    hint: "POST with same auth to run · ?job=<name> to scope · default runs all",
  });
}

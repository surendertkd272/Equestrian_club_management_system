import { NextRequest, NextResponse } from "next/server";
import { runAllSweeps, SWEEP_JOBS, type SweepResult } from "@/lib/sweeps";
import { alertSweepFailures } from "@/lib/sweeps/alert";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import crypto from "node:crypto";

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
//   - ?secret=<CRON_SECRET>                         (Vercel Cron, which doesn't set headers reliably)
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

// POST = run sweeps. Optional ?job=<name> picks a single sweep; default runs all.
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
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
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    available_jobs: Object.keys(SWEEP_JOBS),
    hint: "POST with same auth to run · ?job=<name> to scope · default runs all",
  });
}

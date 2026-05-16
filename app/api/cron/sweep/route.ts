import { NextRequest, NextResponse } from "next/server";
import { runAllSweeps, SWEEP_JOBS, type SweepResult } from "@/lib/sweeps";
import { audit } from "@/lib/audit";
import crypto from "node:crypto";

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
  let results: SweepResult[];
  const t0 = Date.now();
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

  return NextResponse.json({ ok: true, elapsedMs, results });
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

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sweepMonthlyReports } from "@/lib/sweeps";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";

// POST /api/reports/monthly-dispatch — trigger the monthly-report-card sweep
// from the admin UI. The cron handler at /api/cron/sweep is shared-secret
// gated; this is the session-gated equivalent for "send now" on the
// reports page. Only managers can fire it because the sweep can dispatch
// hundreds of emails in a single run.
export async function POST(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!["SUPER_ADMIN", "CENTRE_MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  // force=true bypasses the "only on the 1st" guard inside the sweep so a
  // mid-month "resend" works. The sweep's per-rider dedup still applies:
  // a rider who already got their card in the last 20 days is skipped.
  const result = await sweepMonthlyReports({ force: true });

  await audit({
    userId: session.userId,
    action: "report.monthly_dispatch_triggered",
    tableName: "report",
    rowId: "monthly",
    after: result,
  });

  return NextResponse.json({ ok: true, result });
}

import { sendEmail, renderEmail } from "../email";
import { initSentry } from "../sentry";
import type { SweepResult } from "./shared";

// Ops alerting for the nightly sweep batch. The sweeps drive money (dunning)
// and safety (vaccination/medicine expiry) — a job that fails silently for a
// week is an incident. Two channels, both best-effort and both no-ops until
// their env is configured:
//
//   1. Sentry        — one captureException per failed job (needs SENTRY_DSN
//                      + @sentry/nextjs installed; same dynamic-require
//                      pattern as lib/sentry.ts).
//   2. Ops email     — ONE digest email per run listing every failed job,
//                      sent to OPS_ALERT_EMAIL. Dedup-keyed per day via the
//                      dispatch-log window so a Vercel retry of the batch
//                      doesn't double-page.
//
// Never throws: alerting failures must not fail the sweep response itself.
export async function alertSweepFailures(
  results: SweepResult[],
  ctx: { scope: string; elapsedMs: number },
): Promise<void> {
  const failed = results.filter((r) => r.error);
  if (failed.length === 0) return;

  // ── 1. Sentry ──────────────────────────────────────────────────────────
  try {
    initSentry();
    if (process.env.SENTRY_DSN) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Sentry = require("@sentry/nextjs");
      for (const f of failed) {
        Sentry.captureException(new Error(`[sweep:${f.job}] ${f.error}`), {
          tags: { sweep_job: f.job, sweep_scope: ctx.scope },
        });
      }
    }
  } catch {
    // @sentry/nextjs not installed — fine, email below still fires.
  }

  // ── 2. Ops email digest ────────────────────────────────────────────────
  try {
    const to = process.env.OPS_ALERT_EMAIL;
    if (!to) {
      console.warn(
        `[sweep-alert] ${failed.length} job(s) failed but OPS_ALERT_EMAIL is not set — ` +
          `nobody was emailed. Failed: ${failed.map((f) => f.job).join(", ")}`,
      );
      return;
    }
    const day = new Date().toISOString().slice(0, 10);
    const rows = failed
      .map(
        (f) =>
          `<tr><td style="padding:4px 8px;font-family:monospace;">${f.job}</td>` +
          `<td style="padding:4px 8px;color:#b91c1c;">${escapeHtml(f.error ?? "unknown")}</td></tr>`,
      )
      .join("");
    await sendEmail({
      to,
      subject: `⚠️ Sweep failure: ${failed.length} job(s) failed (${day})`,
      html: renderEmail({
        heading: `${failed.length} sweep job(s) failed`,
        body:
          `<p>The <strong>${ctx.scope}</strong> sweep run finished in ${ctx.elapsedMs}ms with failures:</p>` +
          `<table style="border-collapse:collapse;font-size:13px;">${rows}</table>` +
          `<p style="margin-top:16px;">Full per-job results are in the audit log under <code>cron.sweep</code>. ` +
          `Re-run a single job with <code>POST /api/cron/sweep?job=&lt;name&gt;</code>.</p>`,
      }),
      text:
        `${failed.length} sweep job(s) failed (scope: ${ctx.scope}, ${ctx.elapsedMs}ms):\n` +
        failed.map((f) => `  - ${f.job}: ${f.error}`).join("\n"),
      // Day-bucketed dedup key: a batch retry the same day won't re-email.
      ref: { type: "cron.sweep_failure", rowId: `${ctx.scope}:${day}` },
    });
  } catch (e) {
    console.error("[sweep-alert] failed to send ops alert:", e);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

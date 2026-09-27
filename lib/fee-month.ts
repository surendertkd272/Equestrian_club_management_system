import { wallPartsInTz } from "@/lib/tz";

// A monthly fee's month, as "YYYY-MM" — the month the fee is FOR, not the day
// it was paid (September's fee often arrives on 3 October).

export const FEE_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isFeeMonth(s: unknown): s is string {
  return typeof s === "string" && FEE_MONTH_RE.test(s);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09" → "Sep 2026". */
export function formatFeeMonth(m: string): string {
  if (!isFeeMonth(m)) return m;
  const [y, mm] = m.split("-");
  return `${MONTHS[Number(mm) - 1]} ${y}`;
}

/** The current month in the centre's own zone (the server runs in UTC). */
export function currentFeeMonth(tz = "Asia/Kolkata", now = new Date()): string {
  return wallPartsInTz(now, tz).date.slice(0, 7);
}

// Coaches collect the month's fee from families and record it; that is the
// whole of what they may do with money here. Invoices, reversals and
// everything else stay with finance.write.
export const FEE_RECORDER_ROLES = new Set(["COACH", "HEAD_COACH"]);

// The free-text part of a fee's reason, without the "Monthly fee — Sep 2026"
// or "Advance" label the system writes in front of it.
export function feeNoteOf(reason: string | null): string {
  return (reason ?? "").replace(/^(Advance|Monthly fee — [A-Za-z]{3} \d{4})( — | · )?/, "");
}

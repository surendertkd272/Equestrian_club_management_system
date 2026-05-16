// Localised formatters. Today only "en-IN" with DD MMM YYYY dates + INR
// currency; the lookup-by-locale shape is here so future locales (Hindi,
// Marathi, Tamil) plug in without refactoring callers.

const DEFAULT_LOCALE = "en-IN";

export function formatDateIndia(d: Date | string | number | null | undefined): string {
  if (d == null) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  // 03 Jun 2026 — the form Indian clubs print on flyers + report cards.
  return date.toLocaleDateString(DEFAULT_LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTimeIndia(d: Date | string | number | null | undefined): string {
  if (d == null) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  // 03 Jun 2026, 14:30 — 24h clock matches the rest of the UI.
  return date.toLocaleString(DEFAULT_LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatINR(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

// Compact relative-time formatter for "5 min ago" / "in 3 days" — used by the
// activity timeline + notification dropdown.
export function timeAgo(d: Date | string | number | null | undefined): string {
  if (d == null) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const sec = Math.round(diff / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);

  const rtf = new Intl.RelativeTimeFormat(DEFAULT_LOCALE, { numeric: "auto" });
  if (abs < 60 * 1000) return rtf.format(sec, "second");
  if (abs < 60 * 60 * 1000) return rtf.format(min, "minute");
  if (abs < 24 * 60 * 60 * 1000) return rtf.format(hr, "hour");
  if (abs < 30 * 24 * 60 * 60 * 1000) return rtf.format(day, "day");
  return formatDateIndia(date);
}

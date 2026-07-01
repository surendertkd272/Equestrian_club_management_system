// Human-readable labels for machine tokens (enum values, roles, statuses).
//
// Values are stored as tokens — lowercase ("active", "past_due") or UPPER_SNAKE
// for roles ("INVENTORY_MANAGER") — and must stay that way for DB comparisons
// and routing. This module formats them for DISPLAY only: never feed the result
// back into a query or a comparison.
//
//   formatEnum("past_due")        → "Past Due"
//   formatEnum("active")          → "Active"
//   roleLabel("INVENTORY_MANAGER")→ "Inventory Manager"

// Tokens whose casing must be preserved verbatim (acronyms, brands).
const PRESERVE: Record<string, string> = {
  hq: "HQ", kyc: "KYC", efi: "EFI", bhs: "BHS", fei: "FEI", sop: "SOP",
  pdf: "PDF", csv: "CSV", id: "ID", url: "URL", phi: "PHI", cms: "CMS",
  qr: "QR", nps: "NPS", bmi: "BMI", pf: "PF", esic: "ESIC", saas: "SaaS",
  gst: "GST", gstin: "GSTIN", upi: "UPI", neft: "NEFT", rtgs: "RTGS",
  imps: "IMPS", otp: "OTP", emi: "EMI", ifsc: "IFSC", pan: "PAN", ot: "OT",
  po: "PO", cod: "COD", whatsapp: "WhatsApp", aadhaar: "Aadhaar", nsaid: "NSAID",
};

// Units of measure — always lowercase, even as first/last word.
const UNITS = new Set([
  "cm", "mm", "km", "kg", "mg", "ml", "hrs", "hr", "min", "mins",
  "sec", "kmph", "bpm", "cc", "ft", "l", "g",
]);

// Minor words — lowercase in the middle of a phrase (but capitalised if first
// or last).
const MINOR = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet", "of", "to",
  "in", "on", "at", "by", "up", "as", "per", "vs", "via", "with", "from", "into",
]);

function capCore(core: string, isFirst: boolean, isLast: boolean): string {
  const low = core.toLowerCase();
  if (/\d/.test(core)) return core; // 60d, 24h, 17.5 — leave verbatim
  if (PRESERVE[low]) return PRESERVE[low];
  if (UNITS.has(low)) return low;
  if (MINOR.has(low) && !isFirst && !isLast) return low;
  return core.charAt(0).toUpperCase() + core.slice(1).toLowerCase();
}

function fixWord(word: string, isFirst: boolean, isLast: boolean): string {
  if (PRESERVE[word.toLowerCase()]) return PRESERVE[word.toLowerCase()];
  const m = word.match(/^([^0-9A-Za-z]*)(.*?)([^0-9A-Za-z]*)$/);
  if (!m) return word;
  const [, prefix, coreRaw, suffix] = m;
  let core = coreRaw;
  if (!core) return word;
  if (core.includes("-")) {
    // Hyphenated compounds: capitalise each part (No-Show, Check-In, Off-Site).
    core = core
      .split("-")
      .map((p) => (p ? capCore(p, true, true) : p))
      .join("-");
  } else {
    core = capCore(core, isFirst, isLast);
  }
  return prefix + core + suffix;
}

/** Title-case a display phrase. Not for enum tokens with underscores — use formatEnum. */
export function titleCase(s: string): string {
  const words = s.split(" ");
  const realIdx = words
    .map((w, i) => (/[A-Za-z]/.test(w) ? i : -1))
    .filter((i) => i >= 0);
  if (realIdx.length === 0) return s;
  const first = realIdx[0];
  const last = realIdx[realIdx.length - 1];
  return words.map((w, i) => fixWord(w, i === first, i === last)).join(" ");
}

/**
 * Format a stored enum/status token for display. Replaces underscores with
 * spaces and title-cases. DISPLAY ONLY — the input token is unchanged.
 */
export function formatEnum(value: string | null | undefined): string {
  if (!value) return "";
  return titleCase(String(value).replace(/_/g, " ").trim());
}

/** Friendly, title-cased role name, e.g. "INVENTORY_MANAGER" → "Inventory Manager". */
export function roleLabel(role: string | null | undefined): string {
  return formatEnum(role);
}

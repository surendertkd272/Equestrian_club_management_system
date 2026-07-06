import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Whole-years age for display. Prefers a date of birth (kept current as time
// passes); falls back to a stored age integer for records captured before DOB
// was collected. Returns null when neither is present.
export function displayAgeYears(dob?: Date | string | null, fallbackYears?: number | null): number | null {
  if (dob) {
    const d = typeof dob === "string" ? new Date(dob) : dob;
    if (!Number.isNaN(d.getTime())) {
      const now = new Date();
      let years = now.getFullYear() - d.getFullYear();
      const md = now.getMonth() - d.getMonth() || now.getDate() - d.getDate();
      if (md < 0) years -= 1;
      if (years >= 0) return years;
    }
  }
  return fallbackYears ?? null;
}

export function calcBmi(heightCm?: number | null, weightKg?: number | null) {
  if (!heightCm || !weightKg) return null;
  const m = heightCm / 100;
  if (m <= 0) return null;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function maskAadhaar(num?: string | null) {
  if (!num) return "—";
  const digits = num.replace(/\D/g, "");
  if (digits.length < 4) return "XXXX XXXX XXXX";
  return `XXXX XXXX ${digits.slice(-4)}`;
}

// BMI classification helpers.
//
// IMPORTANT CAVEAT: these are WHO ADULT bands. They are not correct for
// children/adolescents — the WHO publishes age-and-sex-adjusted BMI
// percentile curves for under-18s that we don't implement here. Using
// adult thresholds on a 10-year-old will misclassify a healthy child.
//
// Decision (logged 2026-Oct): start with adult bands so we have any
// visibility at all; upgrade to age-adjusted percentiles when:
//   (a) the centre has access to a published lookup table, AND
//   (b) the rider's age + sex are reliably captured at onboarding.
//
// The UI surfaces show a small "(adult-band)" suffix on the band label so
// staff don't take it as medical-grade advice.

export type BmiBand = "underweight" | "normal" | "overweight" | "obese" | "unknown";

export function bmiBand(bmi: number | null | undefined): BmiBand {
  if (bmi === null || bmi === undefined || bmi <= 0) return "unknown";
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "overweight";
  return "obese";
}

// True for any band that warrants a soft heads-up to the rider/staff.
// 'normal' and 'unknown' don't trigger a banner.
export function bmiNeedsAttention(band: BmiBand): boolean {
  return band === "underweight" || band === "overweight" || band === "obese";
}

// Human-readable label for the band. Suffix flags adult-only validity.
export function bmiBandLabel(band: BmiBand): string {
  switch (band) {
    case "underweight":
      return "Underweight (adult-band)";
    case "normal":
      return "Within normal range (adult-band)";
    case "overweight":
      return "Overweight (adult-band)";
    case "obese":
      return "Obese (adult-band)";
    default:
      return "BMI not recorded";
  }
}

// Tone hint for badge styling — consumer maps to its own variant.
export function bmiBandTone(band: BmiBand): "default" | "warning" | "destructive" | "success" {
  if (band === "normal") return "success";
  if (band === "overweight" || band === "underweight") return "warning";
  if (band === "obese") return "destructive";
  return "default";
}

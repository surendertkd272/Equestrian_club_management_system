// Slug derivation for self-signup.
//
// The owner-operated wizard asks for slugs explicitly, because the person
// filling it in knows what a slug is. Someone signing their riding club up does
// not, and asking them to invent two URL identifiers is a good way to lose them
// on the first screen — so we derive both from the club's name and only surface
// the result.
//
// Must satisfy the same rule the schema enforces:
//   /^[a-z][a-z0-9-]*[a-z0-9]$/  — starts with a letter, ends alphanumeric.

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Must start with a letter: a club called "4 Hooves" would otherwise produce
  // an invalid slug and fail validation with nothing the user can act on.
  const withLetter = /^[a-z]/.test(base) ? base : `club-${base}`;
  const trimmed = withLetter.slice(0, 30).replace(/-+$/g, "");
  // Two chars minimum, and the last character must be alphanumeric.
  return trimmed.length >= 2 ? trimmed : "club";
}

/**
 * First free slug in the series `base`, `base-2`, `base-3`… — `isTaken` does
 * the lookup so this stays pure and testable.
 *
 * Suffixes are appended within the 30-char cap rather than beyond it, so a long
 * club name can still disambiguate instead of colliding forever.
 */
export async function uniqueSlug(
  desired: string,
  isTaken: (slug: string) => Promise<boolean>,
  maxAttempts = 50,
): Promise<string | null> {
  const base = slugify(desired);
  if (!(await isTaken(base))) return base;
  for (let n = 2; n <= maxAttempts; n++) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, 30 - suffix.length).replace(/-+$/g, "") + suffix;
    if (!(await isTaken(candidate))) return candidate;
  }
  return null;
}

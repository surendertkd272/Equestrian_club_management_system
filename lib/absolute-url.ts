// Absolute URLs for anything that leaves the app — emails, QR codes, WhatsApp.
//
// A relative link is dead on arrival in an inbox: the mail client has no origin
// to resolve it against, so the recipient sees a broken link and the club
// concludes the feature doesn't work. This has already happened once here, on
// the shareable registration links.
//
// So this THROWS rather than returning a path when no base URL is configured.
// A caller that fails loudly at send time is recoverable; one that quietly
// emails a dead link to ninety parents is not.

// Read at CALL time, not module scope. A module-level const captures whatever
// process.env held at import, which on a server that loads this early means a
// later-populated variable is invisible for the life of the process — and it
// makes the behaviour untestable, since a test cannot arrange the environment
// after the import.
function candidates(): (string | undefined)[] {
  return [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_BASE_URL,
    // Vercel injects this on every deployment; a sensible last resort rather
    // than giving up entirely.
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
  ];
}

export function baseUrl(): string {
  for (const candidate of candidates()) {
    const trimmed = candidate?.trim().replace(/\/+$/, "");
    if (trimmed) return trimmed;
  }
  throw new Error(
    "No public base URL configured — set NEXT_PUBLIC_APP_URL. Refusing to build a " +
      "relative link for an email, which would arrive broken.",
  );
}

export function absoluteUrl(path: string): string {
  return `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/** True when a link can be built at all — for gating UI that would otherwise fail. */
export function hasBaseUrl(): boolean {
  try {
    baseUrl();
    return true;
  } catch {
    return false;
  }
}

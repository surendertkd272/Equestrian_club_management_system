// Public-facing contact details for the org — shown on the Help Center, portals,
// invoices, and any "contact us / need help" surface. The values live on the
// Organisation row (supportEmail / supportPhone) and are edited by SUPER_ADMIN /
// ADMIN at /settings. When an org hasn't set one, we fall back to these defaults.

export const DEFAULT_SUPPORT_EMAIL = "info@equiwings.com";

/** The org's public support email, or the platform default when unset. */
export function supportEmailFor(org: { supportEmail?: string | null } | null | undefined): string {
  return org?.supportEmail?.trim() || DEFAULT_SUPPORT_EMAIL;
}

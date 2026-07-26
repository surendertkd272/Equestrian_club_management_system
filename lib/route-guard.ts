// One-liner page guard. Replaces the repeated trio of
//   const session = (await getSession())!;
//   if (!canAccessRoute(session.role, "/x")) redirect("/dashboard");
// with a single call. Bound to the NAV permission table (sidebar-nav.ts) so
// a page's role gate stays in lock-step with the sidebar link — drift here
// is what caused the access-control gaps surfaced in the QA pass.

import { redirect } from "next/navigation";
import { getSession, type SessionPayload } from "./auth";
import { canAccessRoute } from "@/components/shell/sidebar-nav";
import type { Role } from "./roles";

// Ensure a session exists AND the role is allowed to view `href`.
// Returns the session (asserted non-null) so the caller can keep using it.
// `unauthRedirect` defaults to /login; `denyRedirect` to /dashboard.
export async function assertRoute(
  href: string,
  opts: { unauthRedirect?: string; denyRedirect?: string } = {},
): Promise<SessionPayload> {
  const session = await getSession();
  // ?ended=1 matches requireSession(). Reaching here with no session means the
  // cookie verified at the middleware but the session was revoked underneath it
  // (deactivated user, sign-out-everywhere, suspended org…), so the login page
  // should say so rather than silently re-prompt. A genuinely logged-out
  // request never gets this far — middleware redirects it with ?next= instead.
  if (!session) redirect(opts.unauthRedirect ?? "/login?ended=1");
  if (!canAccessRoute(session.role as Role, href)) redirect(opts.denyRedirect ?? "/dashboard");
  return session;
}

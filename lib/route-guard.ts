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
  if (!session) redirect(opts.unauthRedirect ?? "/login");
  if (!canAccessRoute(session.role as Role, href)) redirect(opts.denyRedirect ?? "/dashboard");
  return session;
}

"use client";

// Shared client-side sign-out flow. Four places sign users out (staff
// topbar + school / parent / student portals); they all need to do the
// same three things in sequence:
//
//   1. POST /api/auth/logout — server clears the session cookie.
//   2. Purge the service worker's stale-while-revalidate cache. Without
//      this, the next user on the same browser can see this session's
//      private pages from cache (the SW serves GETs without re-checking
//      auth — that's intentional for offline; the cost is that signing
//      out doesn't otherwise wipe what was visible).
//   3. router.push('/login') + router.refresh() — leaves the protected
//      shell and forces the new login page to render with no stale RSC.
//
// Failures in step 2 (SW unavailable, disabled, postMessage rejected)
// are swallowed — the user still gets logged out at the server, which
// is the bit that matters.

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

export async function signOutAndRedirect(router: AppRouterInstance): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      reg?.active?.postMessage({ type: "PURGE_CACHE" });
    }
  } catch {
    // SW unavailable / disabled — proceed with the navigation.
  }
  router.push("/login");
  router.refresh();
}

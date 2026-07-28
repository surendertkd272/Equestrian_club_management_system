"use client";

import { useRouter } from "next/navigation";
import { signOutAndRedirect } from "@/lib/client-logout";

// The topbar's sign-out, reused. A plain <Link href="/api/auth/logout"> issues
// a GET; that route exports only POST, so it answered 405 and left the session
// cookie in place — on the one page whose entire purpose is being stuck.
export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => signOutAndRedirect(router)}
      className="rounded-md border bg-card px-4 py-2 text-sm font-medium hover:bg-muted"
    >
      Sign out
    </button>
  );
}

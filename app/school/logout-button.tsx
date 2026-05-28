"use client";

// School Administrator logout. Mirrors the staff topbar's logout flow
// (fetch + SW-cache purge + router.push) rather than a plain <form> POST
// — the form approach renders the API's raw {"ok":true} JSON when the
// browser navigates to the endpoint, which is what surfaced as the
// "sign out shows {"ok":true}" bug.
//
// The SW cache purge matters here too: school-admin views show student
// names + attendance + skill levels, which the service worker may have
// stale-while-revalidate'd. On a shared school computer the next person
// to open a browser tab could see the previous user's pages from cache
// without ever hitting the auth check. The purge wipes the cache so the
// next request goes through.

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        reg?.active?.postMessage({ type: "PURGE_CACHE" });
      }
    } catch {
      // SW unavailable / disabled — proceed with the navigation anyway.
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <Button variant="outline" size="sm" onClick={logout}>
      <LogOut className="mr-1 h-4 w-4" /> Sign out
    </Button>
  );
}

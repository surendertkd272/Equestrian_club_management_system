"use client";

import { useRouter } from "next/navigation";

export function OwnerLogoutButton() {
  const router = useRouter();
  async function onClick() {
    await fetch("/api/owner/auth/logout", { method: "POST" });
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        reg?.active?.postMessage({ type: "PURGE_CACHE" });
      }
    } catch {}
    router.push("/owner/login");
    router.refresh();
  }
  return (
    <button
      onClick={onClick}
      className="rounded border border-border px-2 py-1 text-foreground hover:bg-muted"
    >
      Sign out
    </button>
  );
}

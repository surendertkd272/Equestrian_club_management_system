"use client";

// School Administrator logout. Was previously a plain <form> POST which
// browser-navigated to the API and rendered its raw {"ok":true} JSON
// (the original bug). Now shares the canonical client-side sign-out
// flow in lib/client-logout.ts — fetch + SW-cache purge + router push.

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { signOutAndRedirect } from "@/lib/client-logout";

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button variant="outline" size="sm" onClick={() => signOutAndRedirect(router)}>
      <LogOut className="mr-1 h-4 w-4" /> Sign out
    </Button>
  );
}

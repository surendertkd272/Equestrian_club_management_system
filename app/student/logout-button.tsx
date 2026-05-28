"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { signOutAndRedirect } from "@/lib/client-logout";

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button variant="outline" size="sm" onClick={() => signOutAndRedirect(router)}>
      Sign out
    </Button>
  );
}

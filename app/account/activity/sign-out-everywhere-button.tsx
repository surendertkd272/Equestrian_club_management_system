"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { postJson } from "@/lib/client/post-json";

export function SignOutEverywhereButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function trigger() {
    const ok = await openConfirm({
      title: "Sign out of every device?",
      body: "Every active Equiwings session for your account will be killed. You'll be redirected to the login screen on this device too.",
      destructive: true,
      confirmLabel: "Sign out everywhere",
    });
    if (!ok) return;

    setBusy(true);
    const res = await postJson("/api/account/sign-out-everywhere");
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("All sessions ended.");
    router.push("/login");
    router.refresh();
  }

  return (
    <Button variant="destructive" onClick={trigger} disabled={busy}>
      {busy ? "Signing out…" : "Sign out everywhere"}
    </Button>
  );
}

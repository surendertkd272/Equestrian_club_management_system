"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { patchJson } from "@/lib/client/post-json";

// Approve / reject a self-registered (status="pending") vendor. Approve →
// status "active" + active true (joins the working list). Reject → status
// "rejected" + active false (stays hidden; not deleted, so it's auditable).
export function VendorReviewButtons({ vendorId, vendorName }: { vendorId: string; vendorName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      const res = await patchJson(`/api/vendors/${vendorId}`, {
        status: approve ? "active" : "rejected",
        active: approve,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(approve ? `${vendorName} approved` : `${vendorName} rejected`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" disabled={busy} onClick={() => decide(true)}>Approve</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => decide(false)}>Reject</Button>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { safeNextPath } from "@/lib/safe-redirect";
import { postJson } from "@/lib/client/post-json";

// Seeded test accounts shown as quick-pick chips during development so a
// reviewer can switch between roles without remembering each email. The
// dropdown only renders when `quickPickEnabled` is true — the parent page
// passes that flag based on NODE_ENV so production never exposes it.
// Demo accounts live on the GHRC Equiwings centre (slug "ghrc") — the club
// used for UAT. All passwords are "password". The parent/student logins are
// wired to a dedicated "Demo Rider (Test)" so no real rider's data is exposed.
const QUICK_PICK: { label: string; email: string }[] = [
  { label: "HQ Super Admin", email: "super@equiwings.in" },
  { label: "HQ Admin", email: "admin@equiwings.in" },
  { label: "Centre Manager (GHRC)", email: "manager.ghrc@equiwings.in" },
  { label: "Head Coach (GHRC)", email: "headcoach.ghrc@equiwings.in" },
  { label: "Coach (GHRC)", email: "coach.ghrc@equiwings.in" },
  { label: "Examiner (GHRC)", email: "examiner.ghrc@equiwings.in" },
  { label: "Vet (GHRC)", email: "vet.ghrc@equiwings.in" },
  { label: "Inventory Mgr (GHRC)", email: "inventorymanager.ghrc@equiwings.in" },
  { label: "Stable Mgr (GHRC)", email: "stablemanager.ghrc@equiwings.in" },
  { label: "Accountant (GHRC)", email: "accountant.ghrc@equiwings.in" },
  { label: "School Administrator (GHRC)", email: "schooladmin.ghrc@equiwings.in" },
  { label: "Inspection Officer (GHRC)", email: "inspector.ghrc@equiwings.in" },
  { label: "Parent (GHRC)", email: "parent.ghrc@equiwings.in" },
  { label: "Student / Rider (GHRC)", email: "student.ghrc@equiwings.in" },
];

export function LoginForm({
  next,
  quickPickEnabled,
}: {
  next: string;
  // Server passes process.env.NODE_ENV !== "production" so the picker can't
  // leak into a live deploy.
  quickPickEnabled?: boolean;
}) {
  const router = useRouter();
  // Defaults prefilled for dev / UAT convenience. Seed.ts hashes every
  // seeded account with the password "password"; the reset-all-passwords
  // script can re-stamp them all back to the same value if they drift.
  const [email, setEmail] = useState(quickPickEnabled ? "super@equiwings.in" : "");
  const [password, setPassword] = useState(quickPickEnabled ? "password" : "");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await postJson<{ redirect?: string }>("/api/auth/login", { email, password });
    setLoading(false);
    if (!res.ok) {
      if (res.code === "ACCOUNT_SUSPENDED") {
        toast.error(res.message, { duration: 10_000 });
        return;
      }
      toast.error(res.message);
      return;
    }
    // If the caller passed an explicit ?next= we honour it; otherwise use the role-aware
    // redirect the API returned (parents → /parent, staff → /dashboard).
    // Validate ?next= so a crafted /login?next=https://phishy.com link
    // can't redirect post-auth. Falls back to the role-aware redirect.
    const requested = next !== "/dashboard" ? next : (res.data.redirect ?? "/dashboard");
    const target = safeNextPath(requested, res.data.redirect ?? "/dashboard");
    router.push(target);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {quickPickEnabled && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs">
          <div className="mb-1 font-semibold text-amber-900">Dev quick-pick — local testing only</div>
          <select
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setPassword("password");
            }}
            className="h-8 w-full rounded border bg-card px-2 text-xs"
          >
            {QUICK_PICK.map((q) => (
              <option key={q.email} value={q.email}>
                {q.label} — {q.email}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="text-xs text-muted-foreground hover:underline">
            Forgot?
          </Link>
        </div>
        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

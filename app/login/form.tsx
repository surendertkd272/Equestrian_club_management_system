"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { safeNextPath } from "@/lib/safe-redirect";

// Seeded test accounts shown as quick-pick chips during development so a
// reviewer can switch between roles without remembering each email. The
// dropdown only renders when `quickPickEnabled` is true — the parent page
// passes that flag based on NODE_ENV so production never exposes it.
const QUICK_PICK: { label: string; email: string }[] = [
  { label: "HQ Super Admin", email: "super@equiwings.in" },
  { label: "HQ Admin", email: "admin@equiwings.in" },
  { label: "Centre Manager (Bangalore)", email: "manager.bangalore@equiwings.in" },
  { label: "Head Coach (Bangalore)", email: "headcoach.bangalore@equiwings.in" },
  { label: "Coach (Bangalore)", email: "coach.bangalore@equiwings.in" },
  { label: "Examiner (Bangalore)", email: "examiner.bangalore@equiwings.in" },
  { label: "Vet (Bangalore)", email: "vet.bangalore@equiwings.in" },
  { label: "Inventory Mgr (Bangalore)", email: "inventorymanager.bangalore@equiwings.in" },
  { label: "Stable Mgr (Bangalore)", email: "stablemanager.bangalore@equiwings.in" },
  { label: "Accountant (Bangalore)", email: "accountant.bangalore@equiwings.in" },
  { label: "School Administrator (Bangalore)", email: "schooladmin.bangalore@equiwings.in" },
  { label: "Inspection Officer (Bangalore)", email: "inspector.bangalore@equiwings.in" },
  { label: "Parent (Bangalore)", email: "parent.bangalore@equiwings.in" },
  { label: "Student / Rider (Bangalore)", email: "student.bangalore@equiwings.in" },
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
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      if (data.error === "ACCOUNT_SUSPENDED") {
        toast.error(data.message ?? "This tenant has been suspended.", { duration: 10_000 });
        return;
      }
      toast.error(data.message ?? data.error ?? "Invalid credentials");
      return;
    }
    // If the caller passed an explicit ?next= we honour it; otherwise use the role-aware
    // redirect the API returned (parents → /parent, staff → /dashboard).
    // Validate ?next= so a crafted /login?next=https://phishy.com link
    // can't redirect post-auth. Falls back to the role-aware redirect.
    const requested = next !== "/dashboard" ? next : (data.redirect ?? "/dashboard");
    const target = safeNextPath(requested, data.redirect ?? "/dashboard");
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

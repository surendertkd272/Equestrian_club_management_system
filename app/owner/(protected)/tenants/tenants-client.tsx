"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { PlanBadge, StatusBadge } from "../badges";

type Tenant = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  contactName: string | null;
  billingEmail: string | null;
  onboardedAt: string;
  centresCount: number;
  ridersCount: number;
};

export function TenantsClient({ initial }: { initial: Tenant[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState("");
  const [rows, setRows] = useState<Tenant[]>(initial);
  const [loading, setLoading] = useState(false);

  // Debounce the filter inputs by 200ms so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        if (status) params.set("status", status);
        if (plan) params.set("plan", plan);
        const res = await fetch(`/api/owner/tenants?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.tenants)) setRows(data.tenants);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [q, status, plan]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Input
          placeholder="Search by name or slug…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border-slate-700 bg-slate-900 text-slate-100"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-10 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="trial">Trial</option>
          <option value="past_due">Past due</option>
          <option value="suspended">Suspended</option>
        </select>
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          className="h-10 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100"
        >
          <option value="">All plans</option>
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>

      <div className="rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <Th>Tenant</Th>
              <Th>Plan</Th>
              <Th>Status</Th>
              <Th right>Centres</Th>
              <Th right>Riders</Th>
              <Th>Onboarded</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-slate-800 hover:bg-slate-900/40">
                <Td>
                  <Link href={`/owner/tenants/${t.id}`} className="font-medium text-slate-100 hover:underline">
                    {t.name}
                  </Link>
                  <div className="font-mono text-[11px] text-slate-500">{t.slug}</div>
                </Td>
                <Td><PlanBadge plan={t.plan} /></Td>
                <Td><StatusBadge status={t.status} /></Td>
                <Td right>{t.centresCount}</Td>
                <Td right>{t.ridersCount}</Td>
                <Td>{new Date(t.onboardedAt).toLocaleDateString()}</Td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-slate-500">
                  No tenants match these filters.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={6} className="py-3 text-center text-xs text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td className={`px-3 py-2 align-top ${right ? "text-right" : ""}`}>{children}</td>;
}

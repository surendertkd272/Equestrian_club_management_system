"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { roleLabel } from "@/lib/labels";
import { formatDate } from "@/lib/utils";

type Row = {
  id: string;
  name: string;
  email: string;
  role: string;
  status?: string;
  password: string | null;
  issuedAt?: string | null;
};

export function CredentialSheet({
  centres,
  initialCentreId,
}: {
  centres: { id: string; name: string }[];
  initialCentreId: string;
}) {
  const [centreId, setCentreId] = useState(initialCentreId);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);

  const centreName = centres.find((c) => c.id === centreId)?.name ?? "";

  const load = useCallback(async () => {
    if (!centreId) return;
    setBusy(true);
    const res = await fetch(`/api/users/credentials?centreId=${centreId}`, { cache: "no-store" });
    setBusy(false);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      toast.error(e.message ?? e.error ?? "Couldn't load the sheet");
      return;
    }
    setRows((await res.json()).rows);
  }, [centreId]);

  async function issue(includeAlreadyIssued: boolean) {
    if (!centreId) return;
    // Re-issuing replaces working passwords and signs those people out, so it
    // is worth one confirmation rather than a surprise.
    if (
      includeAlreadyIssued &&
      !confirm(
        "This replaces the password of everyone at this centre who already has one, and signs them out of any active session. Continue?",
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await fetch("/api/users/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ centreId, includeAlreadyIssued }),
    });
    setBusy(false);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      toast.error(e.message ?? e.error ?? "Couldn't issue credentials");
      return;
    }
    const body = await res.json();
    if (body.issued.length === 0) {
      toast.info("Everyone here already has an unused password — use “Open sheet” to read it.");
    } else {
      toast.success(`Issued ${body.issued.length} credential${body.issued.length === 1 ? "" : "s"}`);
    }
    await load();
  }

  function copyAll() {
    if (!rows?.length) return;
    const text = [
      `Sign-in details — ${centreName}`,
      "",
      ...rows.map((r) => `${r.name}\t${r.email}\t${r.password ?? "—"}\t${roleLabel(r.role)}`),
      "",
      "Everyone must change their password at first sign-in.",
    ].join("\n");
    navigator.clipboard.writeText(text).then(
      () => toast.success("Sheet copied"),
      () => toast.error("Couldn't copy — select the table and copy manually"),
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Sheet</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Centre"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={centreId}
            onChange={(e) => {
              setCentreId(e.target.value);
              setRows(null);
            }}
          >
            {centres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={load} disabled={busy || !centreId}>
            Open sheet
          </Button>
          <Button size="sm" onClick={() => issue(false)} disabled={busy || !centreId}>
            Issue for new staff
          </Button>
          <Button size="sm" variant="outline" onClick={() => issue(true)} disabled={busy || !centreId}>
            Re-issue for everyone
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {rows === null ? (
          <p className="text-sm text-muted-foreground">
            Pick a centre and choose <strong>Open sheet</strong> to see who currently holds an unused
            password.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody at {centreName} is holding an unused password. Either everyone has signed in and
            set their own — which is the healthy state — or no credentials have been issued yet. Use{" "}
            <strong>Issue for new staff</strong> to create them.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {rows.length} unused credential{rows.length === 1 ? "" : "s"} at {centreName}.
              </p>
              <Button size="sm" variant="outline" onClick={copyAll}>
                Copy sheet
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Email (username)</th>
                    <th className="py-2 pr-3">Password</th>
                    <th className="py-2 pr-3">Role</th>
                    <th className="py-2">Issued</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">{r.name}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{r.email}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{r.password ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline">{roleLabel(r.role)}</Badge>
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {r.issuedAt ? formatDate(r.issuedAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Send these over a channel the person already controls, and not in the same message as
              anything else. Each entry disappears from here the moment that person signs in and
              picks their own password.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type School = { id: string; name: string; riderCount: number };
type Admin = { id: string; name: string; email: string; schoolId: string | null };

export function SchoolsClient({ schools, admins }: { schools: School[]; admins: Admin[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function createSchool() {
    if (name.trim().length < 2) return toast.error("Enter the school's name");
    setBusy("create");
    try {
      const res = await fetch("/api/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          data.error === "ALREADY_EXISTS"
            ? "That school is already listed at this centre."
            : (data.message ?? data.error ?? "Failed"),
        );
        return;
      }
      setName("");
      toast.success("School added");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function assign(userId: string, schoolId: string) {
    setBusy(userId);
    try {
      const res = await fetch("/api/schools", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, schoolId: schoolId || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success(schoolId ? "Fenced to that school" : "Now sees the whole centre");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Label>Add a School</Label>
        <div className="mt-1 flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Delhi Public School Ghaziabad"
            onKeyDown={(e) => e.key === "Enter" && createSchool()}
          />
          <Button onClick={createSchool} disabled={busy !== null}>
            {busy === "create" ? "Adding…" : "Add"}
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Schools are also created automatically from the <code>school</code> column when riders
          register or are bulk-uploaded. Add one by hand only if you want to attach an
          administrator before any of their pupils exist.
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Schools at This Centre ({schools.length})
        </h2>
        {schools.length === 0 ? (
          <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            No schools recorded yet. They appear here as soon as a rider is registered with a
            school name.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {schools.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="font-medium">{s.name}</span>
                <Badge variant="outline">
                  {s.riderCount} rider{s.riderCount === 1 ? "" : "s"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          School Administrators ({admins.length})
        </h2>
        <p className="mb-2 text-xs text-muted-foreground">
          An administrator set to <strong>All riders at this centre</strong> sees every child at
          the club, whichever school they attend. That is right while the centre serves one
          school. Pick a school and they can only ever see those pupils.
        </p>
        {admins.length === 0 ? (
          <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            No school administrator accounts at this centre yet.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {admins.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium">{a.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{a.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  {!a.schoolId && schools.length > 1 && (
                    // Only a warning when it actually matters: more than one
                    // school at this centre means an unfenced account is
                    // looking at other schools' children.
                    <Badge variant="warning">Sees {schools.length} schools</Badge>
                  )}
                  <Select
                    aria-label={`School for ${a.name}`}
                    value={a.schoolId ?? ""}
                    disabled={busy !== null}
                    onChange={(e) => assign(a.id, e.target.value)}
                  >
                    <option value="">All riders at this centre</option>
                    {schools.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

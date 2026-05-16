"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { OFFICIAL_ROLES, type OfficialRole } from "@/lib/schemas/officials";

type User = { id: string; name: string; email: string; role: string };
type Official = {
  id: string;
  role: OfficialRole;
  classNames: string | null;
  appointedAt: string;
  user: User;
};

const ROLE_LABELS: Record<OfficialRole, string> = {
  ground_jury_president: "Ground Jury President",
  ground_jury: "Ground Jury Member",
  technical_delegate: "Technical Delegate",
  course_designer: "Course Designer",
  steward: "Steward",
  veterinarian: "Veterinarian",
  judge_c: "Judge · C",
  judge_e: "Judge · E",
  judge_b: "Judge · B",
  judge_m: "Judge · M",
  judge_h: "Judge · H",
  judge: "Judge (general)",
};

// Federation officials assignment. The list of staff to pick from comes
// from props (parent server-renders only the centre's active users). A
// fresh GET of /api/competitions/[id]/officials re-loads after each
// mutation so the displayed list is always authoritative.
export function OfficialsPanel({
  competitionId,
  canManage,
  staff,
}: {
  competitionId: string;
  canManage: boolean;
  staff: User[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Official[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState(staff[0]?.id ?? "");
  const [role, setRole] = useState<OfficialRole>("judge");
  const [classNames, setClassNames] = useState("");

  async function load() {
    const res = await fetch(`/api/competitions/${competitionId}/officials`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(data.officials)) setRows(data.officials);
    setLoaded(true);
  }
  useEffect(() => { void load(); }, [competitionId]);

  async function appoint() {
    if (!userId) return toast.error("Pick a user.");
    setBusy(true);
    const res = await fetch(`/api/competitions/${competitionId}/officials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role, classNames: classNames.trim() || null }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Failed");
      return;
    }
    toast.success("Appointed.");
    setClassNames("");
    await load();
    router.refresh();
  }

  async function remove(officialId: string) {
    if (!confirm("Remove this appointment?")) return;
    const res = await fetch(`/api/competitions/${competitionId}/officials/${officialId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Failed");
      return;
    }
    toast.success("Removed.");
    await load();
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="grid gap-2 rounded-md border p-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <Label className="text-xs">User</Label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="h-9 w-full rounded border bg-card px-2 text-sm"
            >
              {staff.length === 0 && <option value="">No active users in this centre</option>}
              {staff.map((u) => (
                <option key={u.id} value={u.id}>{u.name} · {u.role}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Role</Label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as OfficialRole)}
              className="h-9 w-full rounded border bg-card px-2 text-sm"
            >
              {OFFICIAL_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Classes (CSV, blank = all)</Label>
            <Input value={classNames} onChange={(e) => setClassNames(e.target.value)} placeholder="Open 110cm, Pre-novice" />
          </div>
          <div className="md:col-span-4 flex justify-end">
            <Button onClick={appoint} disabled={busy || !userId}>{busy ? "…" : "Appoint"}</Button>
          </div>
        </div>
      )}

      {loaded && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No officials assigned yet.</p>
      ) : (
        <ul className="divide-y text-sm">
          {rows.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <div className="font-medium">{o.user.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{ROLE_LABELS[o.role] ?? o.role}</Badge>
                  {o.classNames && <span className="text-xs text-muted-foreground">{o.classNames}</span>}
                  <span className="text-[10px] text-muted-foreground">{o.user.email}</span>
                </div>
              </div>
              {canManage && (
                <Button variant="ghost" size="sm" onClick={() => remove(o.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { roleLabel } from "@/lib/labels";
type Staff = { id: string; name: string; role: string };

export function SupportStaffPanel({
  examId,
  canManage,
  initialJson,
}: {
  examId: string;
  canManage: boolean;
  // Accepts the raw JsonValue from the server component (native jsonb column)
  // or a string blob (legacy / tests). Narrow on read.
  initialJson: unknown;
}) {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [pickedIds, setPickedIds] = useState<string[]>(() => {
    if (initialJson === null || initialJson === undefined || initialJson === "") return [];
    try {
      const arr = typeof initialJson === "string" ? JSON.parse(initialJson) : initialJson;
      return Array.isArray(arr) ? arr.filter((x: unknown) => typeof x === "string") : [];
    } catch {
      return [];
    }
  });
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  // Pull grooms / stable managers / coaches as candidates for ringside help.
  useEffect(() => {
    fetch("/api/users/lookup?role=GROOM,STABLE_MANAGER,COACH,HEAD_COACH")
      .then((r) => r.json())
      .then((d) => Array.isArray(d.users) && setStaff(d.users))
      .catch(() => {});
  }, []);

  async function persist(ids: string[]) {
    setBusy(true);
    try {
      const res = await fetch(`/api/exams/${examId}/support-staff`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: ids }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error ?? "Failed");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!pick || pickedIds.includes(pick)) return;
    const next = [...pickedIds, pick];
    if (await persist(next)) {
      setPickedIds(next);
      setPick("");
      toast.success("Added");
    }
  }

  async function remove(id: string) {
    const next = pickedIds.filter((x) => x !== id);
    if (await persist(next)) {
      setPickedIds(next);
    }
  }

  const picked = pickedIds.map((id) => staff.find((s) => s.id === id)).filter(Boolean) as Staff[];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Support Staff (Test-Day)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {picked.length === 0 ? (
          <p className="text-sm text-muted-foreground">No support staff assigned yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {picked.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded border px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <Badge variant="outline" className="text-[10px]">{roleLabel(s.role)}</Badge>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => remove(s.id)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && staff.length > 0 && (
          <div className="flex items-end gap-2">
            <Select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Add support staff…</option>
              {staff
                .filter((u) => !pickedIds.includes(u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {roleLabel(u.role)}
                  </option>
                ))}
            </Select>
            <Button onClick={add} disabled={!pick || busy} size="sm">
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Course = {
  id: string;
  title: string;
  targetRoles: string | null;
  durationHrs: number | null;
  passingMark: number | null;
  active: boolean;
  enrolments: number;
  certifications: number;
};
type Staff = { id: string; name: string; role: string };

export function TrainingClient({
  canManage,
  courses,
  staff,
}: {
  canManage: boolean;
  courses: Course[];
  staff: Staff[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <CoursesPanel canManage={canManage} courses={courses} />
      <CertsPanel canManage={canManage} staff={staff} courses={courses} />
    </div>
  );
}

function CoursesPanel({ canManage, courses }: { canManage: boolean; courses: Course[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    durationHrs: "",
    passingMark: "",
  });
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!form.title) return toast.error("Title required.");
    setBusy(true);
    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          durationHrs: form.durationHrs ? Number(form.durationHrs) : undefined,
          passingMark: form.passingMark ? Number(form.passingMark) : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed");
        return;
      }
      toast.success("Course created");
      setForm({ title: "", durationHrs: "", passingMark: "" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Courses</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {courses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No courses yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {courses.map((c) => (
              <li key={c.id} className="flex items-start justify-between rounded border bg-muted/30 px-2 py-1">
                <div>
                  <div className="font-medium">{c.title}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {c.durationHrs ? `${c.durationHrs}h · ` : ""}
                    {c.enrolments} enrolled · {c.certifications} certified
                    {c.targetRoles ? ` · ${c.targetRoles}` : ""}
                  </div>
                </div>
                {!c.active && <Badge variant="outline">archived</Badge>}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Stable Safety 101"
            />
            <Input
              type="number"
              value={form.durationHrs}
              onChange={(e) => setForm((f) => ({ ...f, durationHrs: e.target.value }))}
              placeholder="Hours"
            />
            <Input
              type="number"
              min={0}
              max={100}
              value={form.passingMark}
              onChange={(e) => setForm((f) => ({ ...f, passingMark: e.target.value }))}
              placeholder="Pass %"
            />
            <Button onClick={create} disabled={busy} className="sm:col-span-3">
              {busy ? "Creating…" : "+ Add course"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CertsPanel({
  canManage,
  staff,
  courses,
}: {
  canManage: boolean;
  staff: Staff[];
  courses: Course[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    userId: staff[0]?.id ?? "",
    courseId: "",
    title: "",
    issuer: "",
    serialNo: "",
    validUntil: "",
  });
  const [busy, setBusy] = useState(false);
  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function issue() {
    if (!form.userId || !form.title) return toast.error("Pick a staff member and a title.");
    setBusy(true);
    try {
      const res = await fetch("/api/staff-certifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: form.userId,
          courseId: form.courseId || null,
          title: form.title,
          issuer: form.issuer || undefined,
          serialNo: form.serialNo || undefined,
          validUntil: form.validUntil || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed");
        return;
      }
      toast.success("Certification issued");
      setForm({ userId: form.userId, courseId: "", title: "", issuer: "", serialNo: "", validUntil: "" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Issue certification</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Centre managers can issue certifications.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Issue certification</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Staff member</Label>
            <Select value={form.userId} onChange={(e) => set("userId", e.target.value)}>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.role})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label className="text-xs">Linked course (optional)</Label>
            <Select value={form.courseId} onChange={(e) => set("courseId", e.target.value)}>
              <option value="">External / standalone</option>
              {courses.filter((c) => c.active).map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label className="text-xs">Title *</Label>
            <Input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="BHS Stage 3 Coaching"
            />
          </div>
          <div>
            <Label className="text-xs">Issuer</Label>
            <Input
              value={form.issuer}
              onChange={(e) => set("issuer", e.target.value)}
              placeholder="British Horse Society"
            />
          </div>
          <div>
            <Label className="text-xs">Serial #</Label>
            <Input value={form.serialNo} onChange={(e) => set("serialNo", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Valid until (optional)</Label>
            <Input
              type="date"
              value={form.validUntil}
              onChange={(e) => set("validUntil", e.target.value)}
            />
          </div>
        </div>
        <div className="mt-3">
          <Button onClick={issue} disabled={busy} className="w-full">
            {busy ? "Issuing…" : "Issue certification"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

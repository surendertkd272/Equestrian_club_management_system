"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { patchJson } from "@/lib/client/post-json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

const TYPES = [
  { value: "clinic", label: "Clinic (guest coach)" },
  { value: "schooling", label: "Schooling day" },
  { value: "demo", label: "Demo / exhibition" },
  { value: "parent_day", label: "Parent day" },
  { value: "fundraiser", label: "Fundraiser" },
  { value: "external_show", label: "External show (off-site)" },
  { value: "camp", label: "Camp" },
  { value: "open_house", label: "Open house" },
  { value: "other", label: "Other" },
];
const STATUSES = ["draft", "open", "live", "completed", "cancelled"];

export type EditEventInitial = {
  title: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  fee: string;
  capacity: string;
  externalVenue: string;
  externalHostOrg: string;
  description: string;
  contactName: string;
  contactPhone: string;
  isPublic: boolean;
};

export function EditEventForm({ eventId, initial }: { eventId: string; initial: EditEventInitial }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  function set<K extends keyof EditEventInitial>(k: K, v: EditEventInitial[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  const isExternal = form.type === "external_show";
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useUnsavedChanges(dirty && !saving);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    // PATCH accepts nullable fields → send "" as null so a cleared field clears.
    const payload: Record<string, unknown> = {
      title: form.title,
      type: form.type,
      status: form.status,
      startDate: form.startDate,
      endDate: form.endDate,
      fee: Number(form.fee) || 0,
      isPublic: form.isPublic,
      capacity: form.capacity === "" ? null : Number(form.capacity),
      description: form.description || null,
      contactName: form.contactName || null,
      contactPhone: form.contactPhone || null,
      externalVenue: isExternal ? form.externalVenue || null : null,
      externalHostOrg: isExternal ? form.externalHostOrg || null : null,
    };
    const res = await patchJson(`/api/events/${eventId}`, payload);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Event updated");
    router.push(`/events/${eventId}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label>Title *</Label>
          <Input aria-label="Title" required value={form.title} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div>
          <Label>Type *</Label>
          <Select aria-label="Type" value={form.type} onChange={(e) => set("type", e.target.value)}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <Select aria-label="Status" value={form.status} onChange={(e) => set("status", e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        <div>
          <Label>Start date *</Label>
          <Input aria-label="Start date" required type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </div>
        <div>
          <Label>End date *</Label>
          <Input aria-label="End date" required type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </div>
        <div>
          <Label>Fee per rider (₹)</Label>
          <Input aria-label="Fee per rider (₹)" type="number" min={0} value={form.fee} onChange={(e) => set("fee", e.target.value)} />
        </div>
        <div>
          <Label>Capacity</Label>
          <Input aria-label="Capacity" type="number" min={1} value={form.capacity} onChange={(e) => set("capacity", e.target.value)} placeholder="blank = unlimited" />
        </div>
        <div className="md:col-span-2">
          <Label>
            <input type="checkbox" checked={form.isPublic} onChange={(e) => set("isPublic", e.target.checked)} className="mr-1.5" />
            Publish to public page
          </Label>
        </div>
        {isExternal && (
          <>
            <div className="md:col-span-2">
              <Label>External venue</Label>
              <Input aria-label="External venue" value={form.externalVenue} onChange={(e) => set("externalVenue", e.target.value)} placeholder="Host club name + city" />
            </div>
            <div className="md:col-span-2">
              <Label>Hosting organisation</Label>
              <Input aria-label="Hosting organisation" value={form.externalHostOrg} onChange={(e) => set("externalHostOrg", e.target.value)} />
            </div>
          </>
        )}
        <div>
          <Label>Contact name</Label>
          <Input aria-label="Contact name" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
        </div>
        <div>
          <Label>Contact phone</Label>
          <Input aria-label="Contact phone" value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label>Description</Label>
          <Textarea aria-label="Description" value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !form.title}>{saving ? "Saving…" : "Save changes"}</Button>
        <Button type="button" variant="outline" onClick={() => router.push(`/events/${eventId}`)}>Cancel</Button>
      </div>
    </form>
  );
}

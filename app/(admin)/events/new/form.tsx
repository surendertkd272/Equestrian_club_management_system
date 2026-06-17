"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { postJson } from "@/lib/client/post-json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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

export function NewEventForm() {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    title: "",
    type: "clinic",
    startDate: today,
    endDate: today,
    fee: "0",
    capacity: "",
    externalVenue: "",
    externalHostOrg: "",
    description: "",
    contactName: "",
    contactPhone: "",
    isPublic: false,
  });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: any) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // External shows imply off-site, so highlight the venue fields when one
  // is picked — keeps the form readable for the simpler in-house types.
  const isExternal = form.type === "external_show";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload: any = {
      title: form.title,
      type: form.type,
      startDate: form.startDate,
      endDate: form.endDate,
      fee: Number(form.fee) || 0,
      isPublic: form.isPublic,
    };
    if (form.capacity) payload.capacity = Number(form.capacity);
    if (form.description) payload.description = form.description;
    if (isExternal && form.externalVenue) payload.externalVenue = form.externalVenue;
    if (isExternal && form.externalHostOrg) payload.externalHostOrg = form.externalHostOrg;
    if (form.contactName) payload.contactName = form.contactName;
    if (form.contactPhone) payload.contactPhone = form.contactPhone;

    const res = await postJson<{ id: string }>("/api/events", payload);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Event created");
    router.push(`/events/${res.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label>Title *</Label>
          <Input aria-label="Title"
            required
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder='e.g. "Capt Sharma clinic" or "Inter-school show — DPS"'
          />
        </div>
        <div>
          <Label>Type *</Label>
          <Select aria-label="Type" value={form.type} onChange={(e) => set("type", e.target.value)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Fee per rider (₹)</Label>
          <Input aria-label="Fee per rider (₹)" type="number" min={0} value={form.fee} onChange={(e) => set("fee", e.target.value)} />
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
          <Label>Capacity</Label>
          <Input aria-label="Capacity"
            type="number"
            min={1}
            value={form.capacity}
            onChange={(e) => set("capacity", e.target.value)}
            placeholder="leave blank for unlimited"
          />
        </div>
        <div>
          <Label>
            <input
              type="checkbox"
              checked={form.isPublic}
              onChange={(e) => set("isPublic", e.target.checked)}
              className="mr-1.5"
            />
            Publish to public page
          </Label>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Private events stay admin-only until published.
          </p>
        </div>
        {isExternal && (
          <>
            <div className="md:col-span-2">
              <Label>External venue</Label>
              <Input aria-label="External venue"
                value={form.externalVenue}
                onChange={(e) => set("externalVenue", e.target.value)}
                placeholder="Host club name + city"
              />
            </div>
            <div className="md:col-span-2">
              <Label>Hosting organisation</Label>
              <Input aria-label="Hosting organisation"
                value={form.externalHostOrg}
                onChange={(e) => set("externalHostOrg", e.target.value)}
                placeholder="e.g. Royal Riding Academy"
              />
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
          <Textarea aria-label="Description"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
            placeholder="What riders should expect, what to bring, dress code…"
          />
        </div>
      </div>

      <Button type="submit" disabled={saving || !form.title}>
        {saving ? "Creating…" : "Create event"}
      </Button>
    </form>
  );
}

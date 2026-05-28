"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { compressForKind } from "@/lib/image-compress";

type Initial = {
  name: string;
  email: string;
  phone: string;
  role: string;
  centreName: string | null;
  photoUrl?: string | null;
};

export function AccountForm({
  initial,
  endpoints,
}: {
  initial: Initial;
  endpoints: { profile: string; password: string };
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [photoUrl, setPhotoUrl] = useState<string | null>(initial.photoUrl ?? null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);

  const profileDirty = name !== initial.name || phone !== initial.phone || photoUrl !== (initial.photoUrl ?? null);

  async function onPhotoFile(file: File | null) {
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const compressed = await compressForKind(file, "user_photo");
      const fd = new FormData();
      fd.set("kind", "user_photo");
      fd.set("file", compressed);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Prefer the human-readable message (e.g. "File storage isn't
        // configured. Set …"). Fall back to the error code when no message.
        toast.error(data.message ?? data.error ?? "Upload failed");
        return;
      }
      setPhotoUrl(data.url);
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function saveProfile() {
    if (!profileDirty) return;
    setSavingProfile(true);
    try {
      const res = await fetch(endpoints.profile, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name !== initial.name ? name : undefined,
          phone: phone !== initial.phone ? phone : undefined,
          photoUrl: photoUrl !== (initial.photoUrl ?? null) ? photoUrl : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Profile updated");
      router.refresh();
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword() {
    if (newPwd.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    if (newPwd !== confirmPwd) {
      toast.error("New password and confirmation don't match.");
      return;
    }
    setSavingPwd(true);
    try {
      const res = await fetch(endpoints.password, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data.error === "BAD_CURRENT_PASSWORD" ? "Current password is wrong."
          : (data.error ?? "Failed");
        toast.error(msg);
        return;
      }
      toast.success("Password changed");
      setCurrentPwd("");
      setNewPwd("");
      setConfirmPwd("");
    } finally {
      setSavingPwd(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Email and role aren't editable here — contact HQ if either needs to change.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="" className="h-16 w-16 rounded-full border object-cover" />
            ) : (
              <div className="grid h-16 w-16 place-items-center rounded-full border bg-muted text-lg font-semibold uppercase text-muted-foreground">
                {name.split(" ").slice(0, 2).map((p) => p[0]).join("")}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="cursor-pointer text-xs text-primary underline">
                {uploadingPhoto ? "Uploading…" : "Change photo"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={uploadingPhoto}
                  onChange={(e) => onPhotoFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {photoUrl && (
                <button
                  type="button"
                  onClick={() => setPhotoUrl(null)}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="acc-name">Name</Label>
              <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="acc-phone">Phone</Label>
              <Input id="acc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={initial.email} disabled />
            </div>
            <div>
              <Label>Role</Label>
              <Input value={initial.role} disabled />
            </div>
            {initial.centreName && (
              <div className="sm:col-span-2">
                <Label>Centre</Label>
                <Input value={initial.centreName} disabled />
              </div>
            )}
          </div>
          <div className="pt-2">
            <Button onClick={saveProfile} disabled={!profileDirty || savingProfile}>
              {savingProfile ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>
            Verify your current password, then set a new one (8+ characters).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="acc-cur">Current password</Label>
            <Input id="acc-cur" type="password" value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="acc-new">New password</Label>
            <Input id="acc-new" type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="acc-conf">Confirm new password</Label>
            <Input id="acc-conf" type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} />
          </div>
          <div className="pt-2">
            <Button onClick={changePassword} disabled={!currentPwd || !newPwd || savingPwd}>
              {savingPwd ? "Updating…" : "Change password"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

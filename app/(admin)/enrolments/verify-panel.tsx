"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatDate, maskAadhaar } from "@/lib/utils";
import { bmiBand, bmiBandLabel, bmiBandTone } from "@/lib/bmi";

// The document check that now precedes approval.
//
// Approval used to be one click off a summary row showing a name, a phone
// number and a school. Nobody had to open the Aadhaar scan or look at the
// photo they were attesting to, so "approved" recorded that a button was
// pressed, not that anyone had checked anything.
//
// This puts the actual documents in front of the approver and makes the check
// a separate recorded act. Approve stays disabled until it is done.

type Rider = {
  id: string;
  firstName: string;
  lastName: string;
  dob: string | Date;
  mobile: string;
  email: string | null;
  school: string | null;
  schoolClass: string | null;
  schoolSection: string | null;
  addressPresent: string | null;
  pincode: string | null;
  photoUrl: string | null;
  aadhaarDocUrl: string | null;
  aadhaarBackDocUrl: string | null;
  aadhaarNo: string | null;
  heightCm: number | null;
  weightKg: number | null;
  bmi: number | null;
  medicalNotes: string | null;
  allergies: string | null;
  fatherName: string | null;
  motherName: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  indemnitySignedAt: string | Date | null;
  verifiedAt: string | Date | null;
  verifyNote: string | null;
};

function DocLink({ label, url }: { label: string; url: string | null }) {
  if (!url) {
    return (
      <div className="rounded-md border border-dashed p-3 text-center">
        <p className="text-xs font-medium">{label}</p>
        {/* Missing is a finding, not a blank. The verifier needs to notice it. */}
        <p className="mt-1 text-[11px] text-muted-foreground">Not uploaded</p>
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-md border p-2 transition hover:border-primary"
    >
      <p className="mb-1 text-xs font-medium">{label}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} className="h-28 w-full rounded object-cover" />
      <p className="mt-1 text-[11px] text-muted-foreground">Open full size ↗</p>
    </a>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export function VerifyPanel({ rider, canVerify }: { rider: Rider; canVerify: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(rider.verifyNote ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const verified = Boolean(rider.verifiedAt);

  async function act(action: "verify" | "unverify" | "approve" | "reject") {
    if (action === "reject" && !confirm("Reject this enrolment? The rider won't be registered.")) {
      return;
    }
    setBusy(action);
    try {
      const res = await fetch(`/api/enrolments/${rider.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(action === "verify" ? { note } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success(
        action === "verify"
          ? "Documents verified"
          : action === "unverify"
            ? "Verification withdrawn"
            : action === "approve"
              ? data.amount
                ? `Approved · ₹${data.amount} invoice raised`
                : "Approved"
              : "Rejected",
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const bmiValue = rider.bmi ?? null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {verified ? (
          <Badge variant="success">Verified {formatDate(rider.verifiedAt)}</Badge>
        ) : (
          <Badge variant="warning">Not verified</Badge>
        )}
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Review documents"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => act("reject")} disabled={busy !== null}>
          Reject
        </Button>
        <Button
          size="sm"
          onClick={() => act("approve")}
          disabled={busy !== null || !verified}
          // A disabled button with no explanation reads as a bug. Say why.
          title={verified ? undefined : "Review and verify this rider's documents first"}
        >
          {busy === "approve" ? "…" : "Approve"}
        </Button>
      </div>

      {open && (
        <div className="space-y-4 rounded-md border bg-muted/30 p-3 text-left">
          <div>
            <h4 className="mb-2 text-sm font-medium">Documents</h4>
            <div className="grid gap-2 sm:grid-cols-3">
              <DocLink label="Photograph" url={rider.photoUrl} />
              <DocLink label="Aadhaar — front" url={rider.aadhaarDocUrl} />
              <DocLink label="Aadhaar — back" url={rider.aadhaarBackDocUrl} />
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-medium">Details to check against them</h4>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fact label="Name" value={`${rider.firstName} ${rider.lastName}`} />
              <Fact label="Date of birth" value={formatDate(rider.dob)} />
              {/* Masked: the verifier is checking the scan against the record,
                  which the last four digits are enough for. The full number
                  stays encrypted and out of a screen anyone can look over. */}
              <Fact label="Aadhaar on file" value={maskAadhaar(rider.aadhaarNo)} />
              <Fact label="Mobile" value={rider.mobile} />
              <Fact label="School" value={rider.school} />
              <Fact
                label="Class / section"
                value={
                  rider.schoolClass || rider.schoolSection
                    ? `${rider.schoolClass ?? "—"} / ${rider.schoolSection ?? "—"}`
                    : null
                }
              />
              <Fact label="Father" value={rider.fatherName} />
              <Fact label="Mother" value={rider.motherName} />
              <Fact
                label="Emergency contact"
                value={
                  rider.emergencyName
                    ? `${rider.emergencyName}${rider.emergencyPhone ? ` · ${rider.emergencyPhone}` : ""}`
                    : null
                }
              />
              <Fact
                label="Height / weight"
                value={
                  rider.heightCm || rider.weightKg
                    ? `${rider.heightCm ?? "—"} cm / ${rider.weightKg ?? "—"} kg`
                    : null
                }
              />
              <Fact
                label="BMI"
                value={
                  bmiValue != null ? (
                    <span className="flex items-center gap-1.5">
                      {bmiValue.toFixed(1)}
                      <Badge variant={bmiBandTone(bmiBand(bmiValue))}>
                        {bmiBandLabel(bmiBand(bmiValue))}
                      </Badge>
                    </span>
                  ) : null
                }
              />
              <Fact
                label="Indemnity"
                value={
                  rider.indemnitySignedAt ? (
                    <Badge variant="success">Signed {formatDate(rider.indemnitySignedAt)}</Badge>
                  ) : (
                    <Badge variant="destructive">Not signed</Badge>
                  )
                }
              />
              <Fact label="Address" value={rider.addressPresent} />
              <Fact label="PIN" value={rider.pincode} />
            </dl>
          </div>

          {(rider.medicalNotes || rider.allergies) && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950/40">
              <h4 className="text-xs font-medium">Declared medical</h4>
              {rider.medicalNotes && <p className="text-xs">Conditions: {rider.medicalNotes}</p>}
              {rider.allergies && <p className="text-xs">Allergies: {rider.allergies}</p>}
            </div>
          )}

          {canVerify ? (
            <div className="flex flex-wrap items-end gap-2 border-t pt-3">
              <div className="flex-1 space-y-1">
                <label htmlFor={`note-${rider.id}`} className="text-xs text-muted-foreground">
                  Verification note (optional) — anything you had to resolve
                </label>
                <Input
                  id={`note-${rider.id}`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Aadhaar spelling differs, confirmed by phone"
                  className="h-8"
                  disabled={verified}
                />
              </div>
              {verified ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => act("unverify")}
                  disabled={busy !== null}
                >
                  Withdraw verification
                </Button>
              ) : (
                <Button size="sm" onClick={() => act("verify")} disabled={busy !== null}>
                  {busy === "verify" ? "…" : "Mark documents verified"}
                </Button>
              )}
            </div>
          ) : (
            <p className="border-t pt-3 text-xs text-muted-foreground">
              You can review this enrolment but not verify it — that is for HQ or the centre
              manager.
            </p>
          )}

          {verified && rider.verifyNote && (
            <p className="text-xs text-muted-foreground">Note: {rider.verifyNote}</p>
          )}
        </div>
      )}
    </div>
  );
}

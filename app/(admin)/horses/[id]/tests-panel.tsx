"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { postJson } from "@/lib/client/post-json";

export type HorseTestDTO = {
  id: string;
  testType: "coggins" | "glanders" | "urination";
  result: "negative" | "positive" | "pending" | "inconclusive";
  testedAt: string;
  nextDueAt: string | null;
  labName: string | null;
  reportUrl: string | null;
  notes: string | null;
};

const TYPE_LABEL: Record<HorseTestDTO["testType"], string> = {
  coggins: "Coggins (EIA)",
  glanders: "Glanders",
  urination: "Urination (urinalysis)",
};

const RESULT_VARIANT: Record<HorseTestDTO["result"], "success" | "destructive" | "warning" | "outline"> = {
  negative: "success",
  positive: "destructive",
  pending: "warning",
  inconclusive: "outline",
};

export function HorseTestsPanel({
  horseId,
  initial,
  canWrite,
}: {
  horseId: string;
  initial: HorseTestDTO[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [tests, setTests] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const [testType, setTestType] = useState<HorseTestDTO["testType"]>("coggins");
  const [result, setResult] = useState<HorseTestDTO["result"]>("pending");
  const [testedAt, setTestedAt] = useState("");
  const [nextDueAt, setNextDueAt] = useState("");
  const [labName, setLabName] = useState("");
  const [reportUrl, setReportUrl] = useState("");
  const [notes, setNotes] = useState("");

  function resetForm() {
    setTestType("coggins");
    setResult("pending");
    setTestedAt("");
    setNextDueAt("");
    setLabName("");
    setReportUrl("");
    setNotes("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await postJson<{ test: HorseTestDTO }>(`/api/horses/${horseId}/tests`, {
      testType,
      result,
      testedAt: testedAt ? new Date(testedAt).toISOString() : undefined,
      nextDueAt: nextDueAt ? new Date(nextDueAt).toISOString() : null,
      labName: labName.trim() || undefined,
      reportUrl: reportUrl.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setTests((rows) => [res.data.test, ...rows]);
    resetForm();
    setAdding(false);
    toast.success("Test recorded");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {tests.length} test{tests.length === 1 ? "" : "s"} on record
          </div>
          {!adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" /> Record test
            </Button>
          )}
        </div>
      )}

      {adding && (
        <form onSubmit={onSubmit} className="space-y-3 rounded-md border bg-card p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Test type *</Label>
              <Select aria-label="Test type" value={testType} onChange={(e) => setTestType(e.target.value as HorseTestDTO["testType"])}>
                <option value="coggins">Coggins (EIA)</option>
                <option value="glanders">Glanders</option>
                <option value="urination">Urination (urinalysis)</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Result *</Label>
              <Select aria-label="Result" value={result} onChange={(e) => setResult(e.target.value as HorseTestDTO["result"])}>
                <option value="pending">Pending</option>
                <option value="negative">Negative</option>
                <option value="positive">Positive</option>
                <option value="inconclusive">Inconclusive</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Tested at</Label>
              <Input aria-label="Tested at"
                type="datetime-local"
                value={testedAt}
                onChange={(e) => setTestedAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Next due</Label>
              <Input aria-label="Next due"
                type="date"
                value={nextDueAt}
                onChange={(e) => setNextDueAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Lab name</Label>
              <Input aria-label="Lab name" value={labName} onChange={(e) => setLabName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Report URL</Label>
              <Input aria-label="Report URL" value={reportUrl} onChange={(e) => setReportUrl(e.target.value)} placeholder="https://..." />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => { resetForm(); setAdding(false); }}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save test"}
            </Button>
          </div>
        </form>
      )}

      {tests.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No tests recorded yet.</p>
      ) : (
        <ol className="space-y-2">
          {tests.map((t) => (
            <li key={t.id} className="rounded-md border bg-card p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold">{TYPE_LABEL[t.testType]}</span>
                  <Badge variant={RESULT_VARIANT[t.result]}>{t.result}</Badge>
                </div>
                <span className="text-sm font-medium">{formatDate(new Date(t.testedAt))}</span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 text-xs text-muted-foreground sm:grid-cols-4">
                {t.labName && <span>Lab: {t.labName}</span>}
                {t.nextDueAt && <span>Next due: {formatDate(new Date(t.nextDueAt))}</span>}
                {t.reportUrl && (
                  <a href={t.reportUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    Open report
                  </a>
                )}
              </div>
              {t.notes && <div className="mt-2 text-sm">{t.notes}</div>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

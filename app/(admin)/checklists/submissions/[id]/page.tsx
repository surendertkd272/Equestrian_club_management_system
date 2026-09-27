import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { checklistSubmissionAccess } from "@/lib/checklist-access";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { wallPartsInTz } from "@/lib/tz";
import { SignOffButton } from "../../sign-off-button";

export const dynamic = "force-dynamic";

// One filed checklist, in full. The list and the "who has done their checks"
// table only ever showed counts — "Issues: 2" — and there was no page that said
// WHICH two, or what the coach wrote about them. The alert for a not-done
// check links here.

const STATUS: Record<string, { label: string; variant: "success" | "destructive" | "outline" }> = {
  done: { label: "Done", variant: "success" },
  not_done: { label: "Not done", variant: "destructive" },
  na: { label: "N/A", variant: "outline" },
};

export default async function ChecklistSubmissionPage({ params }: { params: { id: string } }) {
  const session = await requireSession();

  const sub = await prisma.checklistSubmission.findUnique({
    where: { id: params.id },
    include: {
      template: { select: { name: true, scope: true } },
      horse: { select: { id: true, name: true, stableNo: true } },
      centre: { select: { name: true, timezone: true } },
      items: { orderBy: { id: "asc" } },
    },
  });
  if (!sub) notFound();

  // 404 rather than 403 so an id from another club reveals nothing.
  const access = await checklistSubmissionAccess(session, sub);
  if (!access.view) notFound();
  const isReviewer = access.review;

  const userIds = [sub.submittedByUserId, sub.reviewedByUserId].filter((x): x is string => !!x);
  const people = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const nameOf = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? "—" : "—");

  // Template order, not insertion order: the snapshot rows carry no order of
  // their own, so read it from the live items where they still exist.
  const tplItems = await prisma.checklistItem.findMany({
    where: { id: { in: sub.items.map((i) => i.itemId) } },
    select: { id: true, orderIndex: true },
  });
  const order = new Map(tplItems.map((t) => [t.id, t.orderIndex]));
  const items = [...sub.items].sort((a, b) => (order.get(a.itemId) ?? 1e9) - (order.get(b.itemId) ?? 1e9));

  const failed = items.filter((i) => i.status === "not_done");
  const done = items.filter((i) => i.status === "done").length;
  const na = items.filter((i) => i.status === "na").length;

  const sections: { name: string; rows: typeof items }[] = [];
  for (const it of items) {
    const name = it.itemSection ?? "Checks";
    const s = sections.find((x) => x.name === name);
    if (s) s.rows.push(it);
    else sections.push({ name, rows: [it] });
  }

  const tz = sub.centre.timezone ?? "Asia/Kolkata";
  const when = wallPartsInTz(sub.submittedAt, tz);
  const heading = sub.horse
    ? `${sub.horse.name}${sub.horse.stableNo ? ` (${sub.horse.stableNo})` : ""}: daily report`
    : `${sub.shift ? sub.shift[0].toUpperCase() + sub.shift.slice(1) : "Daily"} checklist`;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/checklists" className="text-sm text-muted-foreground hover:underline">
          ← Daily Checklist
        </Link>
        <h1 className="text-2xl font-bold">{heading}</h1>
        <p className="text-sm text-muted-foreground">
          {nameOf(sub.submittedByUserId)} · {formatDate(sub.submittedAt)} at {when.time} · {sub.centre.name}
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4 text-sm">
          <span>
            <b>{done}</b> done
          </span>
          <span className={failed.length ? "font-semibold text-amber-700 dark:text-amber-400" : ""}>
            <b>{failed.length}</b> not done
          </span>
          <span className="text-muted-foreground">{na} N/A</span>
          {sub.template.scope === "general" && (
            <span className="text-muted-foreground">
              Declaration: {sub.declarationAgreed ? "✓ ticked" : "not ticked"}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground">Signed off:</span>
            <SignOffButton
              submissionId={sub.id}
              reviewedAt={sub.reviewedAt ? sub.reviewedAt.toISOString() : null}
              canReview={isReviewer}
            />
            {sub.reviewedAt && <span className="text-xs text-muted-foreground">by {nameOf(sub.reviewedByUserId)}</span>}
          </span>
        </CardContent>
      </Card>

      {failed.length > 0 && (
        <Card className="border-amber-300 dark:border-amber-800">
          <CardHeader>
            <CardTitle>Needs Attention</CardTitle>
            <CardDescription>Checks marked not done, with the coach&apos;s remarks.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {failed.map((i) => (
                <li key={i.id} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950">
                  <div className="font-medium">{i.itemLabel}</div>
                  {i.itemSection && <div className="text-xs text-muted-foreground">{i.itemSection}</div>}
                  <div className="mt-1 text-sm">
                    {i.remarks ? i.remarks : <span className="italic text-muted-foreground">No remark given</span>}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {sub.generalNotes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{sub.generalNotes}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Full Report</CardTitle>
          <CardDescription>{sub.template.name}: every check as submitted.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {sections.map((s) => (
            <div key={s.name}>
              <h3 className="mb-2 text-sm font-semibold">{s.name}</h3>
              <ul className="divide-y rounded-md border">
                {s.rows.map((i) => {
                  const st = STATUS[i.status] ?? { label: i.status, variant: "outline" as const };
                  return (
                    <li key={i.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div>{i.itemLabel}</div>
                        {i.remarks && <div className="text-xs text-muted-foreground">{i.remarks}</div>}
                      </div>
                      <Badge variant={st.variant} className="shrink-0">
                        {st.label}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

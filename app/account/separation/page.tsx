// User-facing separation acknowledgement page. Shows the pending
// notice issued by an admin, lets the user write their response, then
// flips them to resigned / terminated on submit.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { SeparationResponseForm } from "./form";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

export default async function SeparationPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const notices = await prisma.separationNotice.findMany({
    where: { userId: session.userId },
    orderBy: { issuedAt: "desc" },
    take: 10,
  });

  const pending = notices.find((n) => n.status === "pending");
  const history = notices.filter((n) => n.status !== "pending");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Separation</h1>
      </div>

      {pending ? (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle>
              {pending.kind === "termination" ? "Termination notice" : "Resignation form"}
            </CardTitle>
            <CardDescription>
              Issued {formatDate(pending.issuedAt)} ·
              {pending.effectiveAt && (
                <> Effective {formatDate(pending.effectiveAt)} ·</>
              )} Please read and submit your acknowledgement / reason below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-line">
              {pending.noticeText}
            </div>
            <SeparationResponseForm
              noticeId={pending.id}
              kind={pending.kind as "termination" | "resignation_request"}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No pending separation notices.
          </CardContent>
        </Card>
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Past Notices</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {history.map((n) => (
                <li key={n.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <Badge variant={n.status === "submitted" ? "outline" : "destructive"}>
                      {formatEnum(n.kind)} · {formatEnum(n.status)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(n.issuedAt)}</span>
                  </div>
                  <div className="mt-2 whitespace-pre-line text-xs text-muted-foreground">
                    {n.noticeText}
                  </div>
                  {n.responseText && (
                    <div className="mt-2 rounded bg-muted/40 p-2 text-xs">
                      <span className="font-semibold">Your response:</span> {n.responseText}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

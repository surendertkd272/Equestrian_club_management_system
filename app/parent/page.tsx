import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getParentChildren } from "@/lib/parent";
import { getFeaturesForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ParentDashboard() {
  const session = (await getSession())!;
  const [children, features] = await Promise.all([
    getParentChildren(session.userId),
    getFeaturesForSession(session),
  ]);
  // Master fee-collection switch. When OFF, hide the "Unpaid invoices"
  // stat entirely — parent shouldn't see a tile that won't go anywhere.
  const showPayment = features.has("fee-collection");

  if (children.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No children linked yet</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Your account isn't linked to a rider yet. Please contact your centre — a manager
          can add the link from the rider's profile.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Your children</h1>
        <p className="text-sm text-muted-foreground">
          {children.length} rider{children.length === 1 ? "" : "s"} linked to your account
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {children.map((c) => (
          <Card key={c.riderId}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>
                  <Link href={`/parent/${c.riderId}`} className="hover:underline">
                    {c.firstName} {c.lastName}
                  </Link>
                </CardTitle>
                <Badge variant="outline">{c.relationship}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {c.centreName} · level {c.currentLevel ?? "—"} · {c.status}
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Stat
                  label="Attendance (30d)"
                  value={
                    c.attendancePct === null
                      ? "—"
                      : `${c.attendancePct}% (${c.attendedSessions}/${c.totalSessions})`
                  }
                />
                <Stat
                  label="Upcoming exam"
                  value={c.upcomingExamAt ? formatDate(c.upcomingExamAt) : "—"}
                />
                <Stat
                  label="Latest certificate"
                  value={c.latestCertificateSerial ?? "—"}
                  mono={!!c.latestCertificateSerial}
                />
                {showPayment && (
                  <Stat
                    label="Unpaid invoices"
                    value={String(c.unpaidInvoiceCount)}
                    tone={c.unpaidInvoiceCount > 0 ? "warning" : "default"}
                  />
                )}
              </div>
              <div className="mt-4">
                <Link href={`/parent/${c.riderId}`} className="text-sm text-primary underline">
                  Open full profile →
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  tone = "default",
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "default" | "warning";
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 ${mono ? "font-mono text-xs" : "font-semibold"} ${tone === "warning" ? "text-amber-600" : ""}`}>
        {value}
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { Phone } from "lucide-react";
import { InjuriesClient } from "./injuries-client";
import { arrayLength } from "@/lib/json-narrow";
import { TruncationNotice } from "@/components/ui/truncation-notice";
import { ResponsiveTable } from "@/components/ui/responsive-table";

export const dynamic = "force-dynamic";

export default async function InjuriesPage() {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);
  // Bind to the caller's org so an HQ user's "all centres" (centreId=null)
  // can't return every org's rows. Fail closed if the org can't be resolved.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");

  const [rows, totalInjuries, horses, riders, centre] = await Promise.all([
    prisma.injuryLog.findMany({
      where: tenantWhere(centreId, orgId),
      orderBy: [{ status: "asc" }, { occurredAt: "desc" }],
      take: 200,
    }),
    prisma.injuryLog.count({ where: tenantWhere(centreId, orgId) }),
    prisma.horse.findMany({
      where: tenantWhere(centreId, orgId),
      select: { id: true, name: true, stableNo: true },
      orderBy: { name: "asc" },
    }),
    prisma.rider.findMany({
      where: { ...tenantWhere(centreId, orgId), status: "active" },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
    }),
    // Pull the centre's emergency contacts so the "Call Doctor" button
    // dials the on-call vet directly. Falls back to a generic helper if
    // no vet contact is configured. Bind by org too so a cookie/picker
    // pointing at a foreign org's centre resolves to null.
    centreId
      ? prisma.centre.findFirst({
          where: { id: centreId, orgId },
          select: { emergencyContactsJson: true },
        })
      : Promise.resolve(null),
  ]);

  // Pick the first vet-typed emergency contact for the call button. Falls
  // back to ambulance if there's no vet, then null (button hidden).
  let emergencyDial: { label: string; number: string } | null = null;
  if (centre?.emergencyContactsJson) {
    // jsonb column — Prisma returns the parsed value directly. Narrow before
    // treating as a typed array; bad/legacy data → skip the button rather
    // than crash the page.
    const raw = centre.emergencyContactsJson as unknown;
    if (Array.isArray(raw)) {
      const list = raw as Array<{ label?: string; number?: string; type?: string }>;
      const vet = list.find((c) => c.type === "vet");
      const ambulance = list.find((c) => c.type === "ambulance");
      const pick = vet ?? ambulance ?? list[0];
      if (pick?.number && pick?.label) emergencyDial = { label: pick.label, number: pick.number };
    }
  }

  // Name resolution per row — single batched lookup against the loaded lists
  // to avoid N+1.
  const horseById = new Map(horses.map((h) => [h.id, h]));
  const riderById = new Map(riders.map((r) => [r.id, r]));

  const active = rows.filter((r) => r.status === "active" || r.status === "recovering");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Injury treatment log</h1>
          <p className="text-sm text-muted-foreground">
            Track injuries for horses and riders. Append treatment entries as care happens,
            and mark recovered when the rider/horse is back to normal duty.
          </p>
        </div>
        {emergencyDial && (
          <a
            href={`tel:${emergencyDial.number.replace(/[^\d+]/g, "")}`}
            className="inline-flex items-center gap-2 rounded-md border-2 border-destructive bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/20"
          >
            <Phone className="h-4 w-4" />
            Call doctor · {emergencyDial.label} <span className="font-mono">{emergencyDial.number}</span>
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Active / recovering" value={active.length} tone={active.length > 0 ? "amber" : undefined} />
        <Kpi label="Severe" value={rows.filter((r) => r.severity === "severe").length} />
        <Kpi label="Total tracked" value={rows.length} />
        <Kpi label="Recovered" value={rows.filter((r) => r.status === "recovered").length} />
      </div>

      <InjuriesClient horses={horses} riders={riders} />

      <Card>
        <CardHeader>
          <CardTitle>Records</CardTitle>
        </CardHeader>
        <CardContent>
          <TruncationNotice shown={rows.length} total={totalInjuries} noun="injuries" />
          <ResponsiveTable
            rows={rows}
            getRowKey={(r) => r.id}
            emptyMessage="No injuries logged. Hopefully it stays that way."
            columns={[
              {
                key: "subject",
                header: "Subject",
                primary: true,
                cell: (r) => {
                  const subjectName =
                    r.subjectType === "horse"
                      ? horseById.get(r.subjectId)?.name ?? "Unknown horse"
                      : riderById.get(r.subjectId)
                        ? `${riderById.get(r.subjectId)!.firstName} ${riderById.get(r.subjectId)!.lastName}`
                        : "Unknown rider";
                  return (
                    <>
                      <div className="font-medium">{subjectName}</div>
                      <div className="text-[10px] uppercase text-muted-foreground">{r.subjectType}</div>
                    </>
                  );
                },
              },
              { key: "occurred", header: "Occurred", cell: (r) => formatDate(r.occurredAt) },
              { key: "location", header: "Location", cell: (r) => r.location ?? "—" },
              {
                key: "severity",
                header: "Severity",
                cell: (r) => (
                  <Badge variant={r.severity === "severe" ? "destructive" : r.severity === "moderate" ? "warning" : "outline"}>
                    {r.severity}
                  </Badge>
                ),
              },
              {
                key: "status",
                header: "Status",
                cell: (r) => {
                  const treatments = arrayLength(r.treatmentJson);
                  return (
                    <>
                      <Badge variant={r.status === "recovered" ? "success" : r.status === "chronic" ? "warning" : "outline"}>
                        {r.status}
                      </Badge>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {treatments} treatment{treatments === 1 ? "" : "s"}
                      </div>
                    </>
                  );
                },
              },
              {
                key: "actions",
                header: "",
                cell: (r) => <InjuryRowActions id={r.id} status={r.status} />,
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}


function Kpi({ label, value, tone }: { label: string; value: number; tone?: "amber" }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === "amber" ? "text-amber-700 dark:text-amber-400" : ""}`}>
        {value}
      </div>
    </div>
  );
}

import { InjuryRowActions } from "./injuries-client";

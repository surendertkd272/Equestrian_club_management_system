import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { tenantWhere, scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { NewTripForm } from "./new-trip";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

const CAN_MANAGE = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "STABLE_MANAGER"];

const STATUS_VARIANT: Record<string, "success" | "warning" | "outline" | "destructive"> = {
  planned: "outline",
  departed: "warning",
  returned: "success",
  cancelled: "destructive",
};

// Transport of horses + equipment to event venues, with an inventory check
// out (loading) and in (return). Lists trips; each opens to its manifest.
export default async function TransportPage() {
  const session = await requireSession();
  if (!CAN_MANAGE.includes(session.role)) redirect("/dashboard");

  const centreId = scopeCentre(session);
  if (!centreId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Event Transport</h1>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Pick a centre from the top-bar filter to plan a trip.
          </CardContent>
        </Card>
      </div>
    );
  }

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");
  const trips = await prisma.venueTrip.findMany({
    where: tenantWhere(centreId, orgId),
    orderBy: [{ status: "asc" }, { departureAt: "desc" }],
    take: 100,
    include: {
      items: { select: { checkedOut: true, checkedIn: true, conditionIn: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Event Transport &amp; Inventory</h1>
      </div>

      <NewTripForm />

      <Card>
        <CardHeader>
          <CardTitle>Trips</CardTitle>
          <CardDescription>{trips.length} total</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            rows={trips}
            getRowKey={(t) => t.id}
            emptyMessage="No trips yet — plan one above."
            columns={[
              {
                key: "event",
                header: "Event",
                primary: true,
                cell: (t) => (
                  <Link href={`/transport/${t.id}`} className="font-medium hover:underline">
                    {t.eventName}
                  </Link>
                ),
              },
              { key: "venue", header: "Venue", cell: (t) => <span className="text-xs">{t.venue}</span> },
              { key: "departure", header: "Departure", cell: (t) => <span className="text-xs">{formatDate(t.departureAt)}</span> },
              {
                key: "loaded",
                header: "Loaded",
                headerClassName: "text-center",
                className: "text-center",
                cell: (t) => `${t.items.filter((i) => i.checkedOut).length}/${t.items.length}`,
              },
              {
                key: "returned",
                header: "Returned",
                headerClassName: "text-center",
                className: "text-center",
                cell: (t) => `${t.items.filter((i) => i.checkedIn).length}/${t.items.length}`,
              },
              {
                key: "issues",
                header: "Issues",
                headerClassName: "text-center",
                cell: (t) => {
                  const issues = t.items.filter(
                    (i) => i.checkedIn && i.conditionIn && i.conditionIn !== "ok",
                  ).length;
                  return (
                    <span className={`text-center ${issues > 0 ? "font-semibold text-amber-700" : ""}`}>
                      {issues || "—"}
                    </span>
                  );
                },
              },
              {
                key: "status",
                header: "Status",
                cell: (t) => <Badge variant={STATUS_VARIANT[t.status] ?? "outline"}>{formatEnum(t.status)}</Badge>,
              },
              {
                key: "open",
                header: "",
                hideOnMobile: true,
                cell: (t) => (
                  <Link href={`/transport/${t.id}`} className="text-xs text-primary underline">
                    Open →
                  </Link>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}

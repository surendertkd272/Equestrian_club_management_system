import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { NewTripForm } from "./new-trip";

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
  const session = (await getSession())!;
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

  const trips = await prisma.venueTrip.findMany({
    where: centreWhere(centreId),
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
        <p className="text-sm text-muted-foreground">
          Plan a trip to a venue, build the manifest of horses + equipment, then check everything
          OUT before departure and IN on return — so anything lost or damaged is caught at once.
        </p>
      </div>

      <NewTripForm />

      <Card>
        <CardHeader>
          <CardTitle>Trips</CardTitle>
          <CardDescription>{trips.length} total</CardDescription>
        </CardHeader>
        <CardContent>
          {trips.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No trips yet — plan one above.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="pb-2">Event</th>
                    <th className="pb-2">Venue</th>
                    <th className="pb-2">Departure</th>
                    <th className="pb-2 text-center">Loaded</th>
                    <th className="pb-2 text-center">Returned</th>
                    <th className="pb-2 text-center">Issues</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {trips.map((t) => {
                    const total = t.items.length;
                    const out = t.items.filter((i) => i.checkedOut).length;
                    const inn = t.items.filter((i) => i.checkedIn).length;
                    const issues = t.items.filter(
                      (i) => i.checkedIn && i.conditionIn && i.conditionIn !== "ok",
                    ).length;
                    return (
                      <tr key={t.id} className="border-t">
                        <td className="py-2 font-medium">{t.eventName}</td>
                        <td className="py-2 text-xs">{t.venue}</td>
                        <td className="py-2 text-xs">{formatDate(t.departureAt)}</td>
                        <td className="py-2 text-center">{out}/{total}</td>
                        <td className="py-2 text-center">{inn}/{total}</td>
                        <td className={`py-2 text-center ${issues > 0 ? "font-semibold text-amber-700" : ""}`}>
                          {issues || "—"}
                        </td>
                        <td className="py-2">
                          <Badge variant={STATUS_VARIANT[t.status] ?? "outline"}>{t.status}</Badge>
                        </td>
                        <td className="py-2 text-right">
                          <Link href={`/transport/${t.id}`} className="text-xs text-primary underline">
                            Open →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

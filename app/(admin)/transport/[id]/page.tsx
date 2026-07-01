import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { TripManifest } from "./manifest";

export const dynamic = "force-dynamic";

const CAN_MANAGE = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "STABLE_MANAGER"];

export default async function TripDetailPage({ params }: { params: { id: string } }) {
  const session = (await getSession())!;
  if (!CAN_MANAGE.includes(session.role)) redirect("/dashboard");

  const centreId = scopeCentre(session);
  const trip = await prisma.venueTrip.findUnique({
    where: { id: params.id },
    include: { items: { orderBy: [{ category: "asc" }, { label: "asc" }] } },
  });
  if (!trip) notFound();
  if (centreId && trip.centreId !== centreId) notFound();
  // HQ (centreId=null) skips the centre check — bind them to their own org so
  // they can't open another organisation's trip by id.
  const orgId = await getOrgIdForSession(session);
  if (!orgId || (await getOrgIdForCentre(trip.centreId)) !== orgId) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/transport">
            <ChevronLeft className="h-4 w-4" /> All trips
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">
          {trip.eventName} <span className="text-sm font-normal text-muted-foreground">· {trip.venue}</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Departure {formatDate(trip.departureAt)}
          {trip.returnAt ? ` · returned ${formatDate(trip.returnAt)}` : ""}
          {" · "}
          <Badge variant="outline">{trip.status}</Badge>
        </p>
        {trip.notes && <p className="mt-1 text-sm text-muted-foreground">{trip.notes}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transport Manifest</CardTitle>
          <CardDescription>
            Add every horse and piece of kit, tick it OUT as you load, and IN on return. Mark
            anything not "ok" to flag a loss or damage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TripManifest
            tripId={trip.id}
            status={trip.status}
            items={trip.items.map((i) => ({
              id: i.id,
              category: i.category,
              label: i.label,
              qtyExpected: i.qtyExpected,
              checkedOut: i.checkedOut,
              conditionOut: i.conditionOut,
              checkedIn: i.checkedIn,
              conditionIn: i.conditionIn,
              remarks: i.remarks,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

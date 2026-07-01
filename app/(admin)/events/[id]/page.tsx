import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { EventStatusControl } from "./status-control";
import { DeleteEntityButton } from "@/components/ui/delete-entity-button";
import { RegistrationsPanel } from "./registrations-panel";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "outline" | "success" | "warning" | "destructive"> = {
  draft: "outline",
  open: "warning",
  live: "success",
  completed: "outline",
  cancelled: "destructive",
};

export default async function EventDetailPage({ params }: { params: { id: string } }) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);

  const ev = await prisma.event.findUnique({
    where: { id: params.id },
    include: {
      registrations: {
        include: { rider: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
      },
      centre: { select: { name: true } },
    },
  });
  if (!ev) notFound();
  if (centreId && ev.centreId !== centreId) notFound();
  // Org-bound HQ users too: scopeCentre() returns null for "all centres", so the
  // centre guard above is skipped for HQ and an Admin could open another org's
  // event by id. Verify the event's centre belongs to the caller's org.
  const orgId = await getOrgIdForSession(session);
  if (!orgId || (await getOrgIdForCentre(ev.centreId)) !== orgId) notFound();

  const riders = await prisma.rider.findMany({
    where: { centreId: ev.centreId, status: "active" },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  });
  const canManage = can(session.role, "event.manage");
  const filled = ev.registrations.filter((r) => r.status !== "cancelled").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/events">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[ev.status] ?? "outline"}>{formatEnum(ev.status)}</Badge>
          {canManage && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/events/${ev.id}/edit`}>Edit</Link>
            </Button>
          )}
          {canManage && <EventStatusControl id={ev.id} currentStatus={ev.status} />}
          {canManage && ev.status !== "live" && ev.status !== "completed" && (
            <DeleteEntityButton
              endpoint={`/api/events/${ev.id}`}
              entityLabel="event"
              redirectTo="/events"
              confirmBody={`"${ev.title}" and its registrations will be permanently removed.`}
            />
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{ev.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-y-2 text-sm md:grid-cols-4">
            <dt className="text-muted-foreground">Type</dt>
            <dd>{formatEnum(ev.type)}</dd>
            <dt className="text-muted-foreground">Dates</dt>
            <dd>
              {formatDate(ev.startDate)}
              {ev.startDate.getTime() !== ev.endDate.getTime() && ` — ${formatDate(ev.endDate)}`}
            </dd>
            <dt className="text-muted-foreground">Centre</dt>
            <dd>{ev.centre.name}</dd>
            <dt className="text-muted-foreground">Fee</dt>
            <dd>{ev.fee > 0 ? `₹${ev.fee.toLocaleString("en-IN")}` : "Free"}</dd>
            {ev.externalVenue && (
              <>
                <dt className="text-muted-foreground">External venue</dt>
                <dd className="md:col-span-3">{ev.externalVenue}</dd>
              </>
            )}
            {ev.externalHostOrg && (
              <>
                <dt className="text-muted-foreground">Hosting organisation</dt>
                <dd className="md:col-span-3">{ev.externalHostOrg}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Capacity</dt>
            <dd>
              {filled}
              {ev.capacity ? ` / ${ev.capacity}` : " · unlimited"}
            </dd>
            <dt className="text-muted-foreground">Visibility</dt>
            <dd>{ev.isPublic ? "Public" : "Private"}</dd>
            {ev.contactName && (
              <>
                <dt className="text-muted-foreground">Contact</dt>
                <dd className="md:col-span-3">
                  {ev.contactName}
                  {ev.contactPhone ? ` · ${ev.contactPhone}` : ""}
                </dd>
              </>
            )}
            {ev.description && (
              <>
                <dt className="text-muted-foreground">Description</dt>
                <dd className="md:col-span-3 whitespace-pre-wrap">{ev.description}</dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>

      <RegistrationsPanel
        eventId={ev.id}
        eventStatus={ev.status}
        fee={ev.fee}
        canManage={canManage}
        registrations={ev.registrations.map((r) => ({
          id: r.id,
          riderId: r.riderId,
          riderName: `${r.rider.firstName} ${r.rider.lastName}`,
          status: r.status,
          paid: r.paid,
          notes: r.notes,
        }))}
        riders={riders.map((r) => ({ id: r.id, label: `${r.firstName} ${r.lastName}` }))}
      />
    </div>
  );
}

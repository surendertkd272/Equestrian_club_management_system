import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditEventForm } from "./edit-event-form";

export const dynamic = "force-dynamic";

export default async function EditEventPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.role, "event.manage")) redirect(`/events/${params.id}`);

  const centreId = scopeCentre(session);
  const ev = await prisma.event.findUnique({ where: { id: params.id } });
  if (!ev) notFound();
  if (centreId && ev.centreId !== centreId) notFound();

  const initial = {
    title: ev.title,
    type: ev.type,
    status: ev.status,
    startDate: ev.startDate.toISOString().slice(0, 10),
    endDate: ev.endDate.toISOString().slice(0, 10),
    fee: String(ev.fee ?? 0),
    capacity: ev.capacity != null ? String(ev.capacity) : "",
    externalVenue: ev.externalVenue ?? "",
    externalHostOrg: ev.externalHostOrg ?? "",
    description: ev.description ?? "",
    contactName: ev.contactName ?? "",
    contactPhone: ev.contactPhone ?? "",
    isPublic: ev.isPublic,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Edit event</h1>
        <Link href={`/events/${ev.id}`} className="text-sm text-primary hover:underline">← Back</Link>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">{ev.title}</CardTitle></CardHeader>
        <CardContent><EditEventForm eventId={ev.id} initial={initial} /></CardContent>
      </Card>
    </div>
  );
}

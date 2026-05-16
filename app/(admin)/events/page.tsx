import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "outline" | "success" | "warning" | "destructive"> = {
  draft: "outline",
  open: "warning",
  live: "success",
  completed: "outline",
  cancelled: "destructive",
};

const TYPE_LABEL: Record<string, string> = {
  clinic: "Clinic",
  schooling: "Schooling",
  demo: "Demo",
  parent_day: "Parent day",
  fundraiser: "Fundraiser",
  external_show: "External show",
  camp: "Camp",
  open_house: "Open house",
  other: "Other",
};

export default async function EventsPage({
  searchParams,
}: {
  searchParams: { status?: string; type?: string };
}) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);
  const where: any = { ...centreWhere(centreId) };
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.type) where.type = searchParams.type;

  const events = await prisma.event.findMany({
    where,
    orderBy: { startDate: "desc" },
    take: 100,
    include: {
      _count: { select: { registrations: true } },
      centre: { select: { name: true } },
    },
  });

  const canManage = can(session.role, "event.manage");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Events</h1>
          <p className="text-sm text-muted-foreground">
            §4.14 / §4.16 · Clinics, schooling days, demos, fundraisers, external shows.
          </p>
        </div>
        {canManage && (
          <Button asChild>
            <Link href="/events/new">
              <Plus className="h-4 w-4" /> New event
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Status</label>
              <select
                name="status"
                defaultValue={searchParams.status ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="open">Open</option>
                <option value="live">Live</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Type</label>
              <select
                name="type"
                defaultValue={searchParams.type ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm" variant="outline">Filter</Button>
          </form>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-2">Title</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Dates</th>
                  <th className="pb-2">Fee</th>
                  <th className="pb-2">Registered</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-t hover:bg-muted/40">
                    <td className="py-2">
                      <Link href={`/events/${e.id}`} className="font-medium hover:underline">
                        {e.title}
                      </Link>
                      {e.externalVenue && (
                        <div className="text-xs text-muted-foreground">{e.externalVenue}</div>
                      )}
                    </td>
                    <td className="py-2 text-xs">{TYPE_LABEL[e.type] ?? e.type}</td>
                    <td className="py-2">
                      {formatDate(e.startDate)}
                      {e.startDate.getTime() !== e.endDate.getTime() && ` — ${formatDate(e.endDate)}`}
                    </td>
                    <td className="py-2">{e.fee > 0 ? `₹${e.fee.toLocaleString("en-IN")}` : "Free"}</td>
                    <td className="py-2">
                      {e._count.registrations}
                      {e.capacity ? <span className="text-xs text-muted-foreground"> / {e.capacity}</span> : null}
                    </td>
                    <td className="py-2">
                      <Badge variant={STATUS_VARIANT[e.status] ?? "outline"}>{e.status}</Badge>
                    </td>
                    <td className="py-2 text-right">
                      <Link href={`/events/${e.id}`} className="text-xs text-primary underline">
                        Manage →
                      </Link>
                    </td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      No events yet.{" "}
                      {canManage && (
                        <Link href="/events/new" className="text-primary underline">
                          Create the first one →
                        </Link>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

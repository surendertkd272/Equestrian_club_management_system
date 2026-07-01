import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { tenantWhere, scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { TruncationNotice } from "@/components/ui/truncation-notice";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { formatEnum } from "@/lib/labels";
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
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const where: any = { ...tenantWhere(centreId, orgId) };
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.type) where.type = searchParams.type;

  const [events, totalEvents] = await Promise.all([
    prisma.event.findMany({
      where,
      orderBy: { startDate: "desc" },
      take: 100,
      include: {
        _count: { select: { registrations: true } },
        centre: { select: { name: true } },
      },
    }),
    prisma.event.count({ where }),
  ]);

  const canManage = can(session.role, "event.manage");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Events</h1>
          <p className="text-sm text-muted-foreground">
            Clinics, schooling days, demos, fundraisers, external shows.
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
              <label className="mb-1 block text-xs text-muted-foreground">Status</label>
              <select aria-label="Filter by status"
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
              <label className="mb-1 block text-xs text-muted-foreground">Type</label>
              <select aria-label="Filter by type"
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
          <TruncationNotice shown={events.length} total={totalEvents} noun="events" />
          <ResponsiveTable
            rows={events}
            getRowKey={(e) => e.id}
            emptyMessage={
              <>
                No events yet.{" "}
                {canManage && (
                  <Link href="/events/new" className="text-primary underline">
                    Create the first one →
                  </Link>
                )}
              </>
            }
            columns={[
              {
                key: "title",
                header: "Title",
                primary: true,
                cell: (e) => (
                  <>
                    <Link href={`/events/${e.id}`} className="font-medium hover:underline">
                      {e.title}
                    </Link>
                    {e.externalVenue && <div className="text-xs text-muted-foreground">{e.externalVenue}</div>}
                  </>
                ),
              },
              { key: "type", header: "Type", cell: (e) => <span className="text-xs">{TYPE_LABEL[e.type] ?? e.type}</span> },
              {
                key: "dates",
                header: "Dates",
                cell: (e) => (
                  <>
                    {formatDate(e.startDate)}
                    {e.startDate.getTime() !== e.endDate.getTime() && ` — ${formatDate(e.endDate)}`}
                  </>
                ),
              },
              { key: "fee", header: "Fee", cell: (e) => (e.fee > 0 ? `₹${e.fee.toLocaleString("en-IN")}` : "Free") },
              {
                key: "registered",
                header: "Registered",
                cell: (e) => (
                  <>
                    {e._count.registrations}
                    {e.capacity ? <span className="text-xs text-muted-foreground"> / {e.capacity}</span> : null}
                  </>
                ),
              },
              { key: "status", header: "Status", cell: (e) => <Badge variant={STATUS_VARIANT[e.status] ?? "outline"}>{formatEnum(e.status)}</Badge> },
              {
                key: "manage",
                header: "",
                hideOnMobile: true,
                cell: (e) => (
                  <Link href={`/events/${e.id}`} className="text-xs text-primary underline">
                    Manage →
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

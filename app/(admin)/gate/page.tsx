import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GatePanel } from "./gate-panel";

export const dynamic = "force-dynamic";

export default async function GatePage({
  searchParams,
}: {
  searchParams: { centre?: string };
}) {
  const session = await requireSession();
  if (!can(session.role, "staff.attendance")) redirect("/dashboard");

  // Centre context resolution. Centre-scoped users have session.centreId
  // pinned via scopeCentre(); HQ admins (SUPER_ADMIN, ADMIN) resolve via:
  //   1. ?centre=<id>  (explicit URL pick — wins, lets you share a link)
  //   2. ew_hq_centre cookie  (topbar switcher pick — applies across pages)
  //   3. null → render the picker below.
  //
  // Before this used `session.centreId ?? searchParams.centre`, which
  // skipped the cookie entirely — an HQ admin who picked "Centre A" in
  // the topbar still saw the picker on /gate. scopeCentre() handles all
  // three sources uniformly.
  const centreId = scopeCentre(session, searchParams.centre);

  // No centre yet — show the picker for SUPER_ADMIN.
  if (!centreId) {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { orgId: true, centre: { select: { orgId: true } } },
    });
    const orgId = user?.orgId ?? user?.centre?.orgId ?? null;
    const centres = orgId
      ? await prisma.centre.findMany({
          where: { orgId },
          select: { id: true, name: true, slug: true },
          orderBy: { name: "asc" },
        })
      : [];

    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Gate Log — Pick a Centre</CardTitle>
            <CardDescription>
              Gate-logging is per-centre. Pick which club's gate you're recording for.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {centres.length === 0 ? (
              <p className="text-sm text-muted-foreground">No centres found.</p>
            ) : (
              centres.map((c) => (
                <Link
                  key={c.id}
                  href={`/gate?centre=${c.id}`}
                  className="block rounded-md border px-3 py-2 text-sm hover:bg-muted"
                >
                  {c.name} <span className="text-xs text-muted-foreground">/ {c.slug}</span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Validate centre belongs to caller's scope. SUPER_ADMIN sees any centre
  // in their org; centre-scoped users only their own.
  if (session.role === "SUPER_ADMIN") {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { orgId: true, centre: { select: { orgId: true } } },
    });
    const orgId = user?.orgId ?? user?.centre?.orgId ?? null;
    const c = await prisma.centre.findUnique({ where: { id: centreId }, select: { orgId: true, name: true } });
    if (!c || c.orgId !== orgId) redirect("/gate");
  }

  // Org-bound every query so an HQ user (esp. ADMIN, which the SUPER_ADMIN-only
  // guard above does NOT cover) can't aim ?centre=<foreign-centre> at another
  // org's roster/events. tenantWhere() pairs the centreId with the caller's org,
  // so a foreign centreId matches 0 rows. Fail closed if the org can't resolve.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");

  // Today's roster — anyone with role !== {SUPER_ADMIN, RIDER, PARENT}
  // attached to this centre, plus their recent gate events.
  const [centre, staff, recentEvents] = await Promise.all([
    prisma.centre.findFirst({ where: { id: centreId, orgId }, select: { name: true } }),
    prisma.user.findMany({
      where: {
        ...tenantWhere(centreId, orgId),
        status: "active",
        role: { notIn: ["SUPER_ADMIN", "RIDER", "PARENT"] },
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.staffGateEvent.findMany({
      where: {
        ...tenantWhere(centreId, orgId),
        occurredAt: { gte: new Date(Date.now() - 86400000) },
      },
      include: { staff: { select: { id: true, name: true, role: true } } },
      orderBy: { occurredAt: "desc" },
      take: 100,
    }),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>Gate log{centre ? ` — ${centre.name}` : ""}</CardTitle>
              <CardDescription>
                Tap In/Out as staff arrive and leave. Last 24 hours of events shown below.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <Link
                href={`/gate/summary${session.role === "SUPER_ADMIN" ? `?centre=${centreId}` : ""}`}
                className="text-primary underline"
              >
                Shift summary →
              </Link>
              {session.role === "SUPER_ADMIN" && (
                <Link href="/gate" className="text-primary underline">
                  Switch centre
                </Link>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <GatePanel
            centreId={centreId}
            staff={staff}
            initial={recentEvents.map((e) => ({
              id: e.id,
              staffUserId: e.staffUserId,
              staffName: e.staff.name,
              staffRole: e.staff.role,
              direction: e.direction as "in" | "out",
              occurredAt: e.occurredAt.toISOString(),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

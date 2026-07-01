import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isRole } from "@/lib/roles";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { USER_STATUSES } from "@/lib/schemas/user-admin";
import { ROLES } from "@/lib/roles";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { UserActions, UserSearchBar, NewUserCard } from "./client";
import { ApprovalQueue } from "./approval-queue";
import { formatEnum, roleLabel } from "@/lib/labels";
export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  role?: string;
  centreId?: string;
  status?: string;
  page?: string;
};

const PAGE_SIZE = 100;

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const session = (await getSession())!;
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") redirect("/dashboard");

  const where: Record<string, unknown> = {};
  if (searchParams.role && isRole(searchParams.role)) where.role = searchParams.role;
  // Centre filter resolution:
  //   - ?centreId=null  → explicitly "users with no centre" (HQ-tier staff)
  //   - ?centreId=<id>  → explicit pick (wins, lets you share the URL)
  //   - else            → fall back to the topbar centre filter via
  //                        scopeCentre (which reads the ew_hq_centre cookie)
  // Previously the cookie was ignored on this page — an HQ admin filtered
  // to Centre A in the topbar still saw all users until they re-picked
  // here. Now the cookie pre-applies; explicit query params still override.
  if (searchParams.centreId === "null") {
    where.centreId = null;
  } else if (searchParams.centreId) {
    where.centreId = searchParams.centreId;
  } else {
    const scopedCentreId = scopeCentre(session);
    if (scopedCentreId) where.centreId = scopedCentreId;
  }
  if (searchParams.status && (USER_STATUSES as readonly string[]).includes(searchParams.status)) {
    where.status = searchParams.status;
  }
  if (searchParams.q?.trim()) {
    where.OR = [
      { name: { contains: searchParams.q.trim() } },
      { email: { contains: searchParams.q.trim() } },
    ];
  }

  // Org-scope: never list/count another tenant's users or centres. HQ users
  // carry orgId; centre staff resolve via centre.orgId. AND-combine so it
  // composes with the q-OR above.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const orgClause = { OR: [{ orgId }, { centre: { orgId } }] };
  where.AND = [orgClause];

  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);

  const [users, centres, totalAll, filteredTotal, pendingApprovals] = await Promise.all([
    prisma.user.findMany({
      where,
      // id tiebreaker keeps ordering stable across pages (name isn't unique).
      orderBy: [{ status: "asc" }, { name: "asc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        centreId: true,
        status: true,
        createdAt: true,
        centre: { select: { name: true, slug: true } },
      },
    }),
    prisma.centre.findMany({ where: { orgId }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
    prisma.user.count({ where: orgClause }),
    prisma.user.count({ where }),
    // Spotlight: pending-approval users (staff hiring invites that have
    // been redeemed). Shown above the main list so admins don't have to
    // remember to filter for them.
    prisma.user.findMany({
      where: { AND: [orgClause, { status: "pending_approval" }] },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
        centre: { select: { name: true, slug: true } },
      },
    }),
  ]);

  const canResetPassword = session.role === "SUPER_ADMIN";
  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (searchParams.q) sp.set("q", searchParams.q);
    if (searchParams.role) sp.set("role", searchParams.role);
    if (searchParams.centreId) sp.set("centreId", searchParams.centreId);
    if (searchParams.status) sp.set("status", searchParams.status);
    sp.set("page", String(p));
    return `/users?${sp.toString()}`;
  };
  const rangeStart = filteredTotal === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = (page - 1) * PAGE_SIZE + users.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-sm text-muted-foreground">
          HQ control · {totalAll} total · {filteredTotal} match · showing {rangeStart}–{rangeEnd}
          {totalPages > 1 ? ` (page ${page} of ${totalPages})` : ""}. Edit role/centre/status, reset
          passwords, suspend accounts. Self-demotion and last-super-admin removal are blocked.
        </p>
      </div>

      <ApprovalQueue
        pending={pendingApprovals.map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          phone: p.phone,
          role: p.role,
          createdAt: p.createdAt.toISOString(),
          centre: p.centre,
        }))}
      />

      <NewUserCard centres={centres} roles={ROLES as readonly string[]} />

      <Card>
        <CardHeader>
          <CardTitle>Search & Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <UserSearchBar
            centres={centres}
            roles={ROLES as readonly string[]}
            initial={{
              q: searchParams.q ?? "",
              role: searchParams.role ?? "",
              centreId: searchParams.centreId ?? "",
              status: searchParams.status ?? "",
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Results ({filteredTotal})</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            rows={users}
            getRowKey={(u) => u.id}
            emptyMessage="No users match."
            columns={[
              {
                key: "name",
                header: "Name",
                primary: true,
                cell: (u) => <div className="font-medium">{u.name}</div>,
              },
              {
                key: "email",
                header: "Email",
                className: "font-mono text-xs",
                cell: (u) => u.email,
              },
              {
                key: "phone",
                header: "Phone",
                className: "font-mono text-xs",
                cell: (u) =>
                  u.phone ? (
                    <a href={`tel:${u.phone}`} className="hover:underline">{u.phone}</a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
              {
                key: "role",
                header: "Role",
                cell: (u) => <Badge variant="outline">{roleLabel(u.role)}</Badge>,
              },
              {
                key: "centre",
                header: "Centre",
                className: "text-xs",
                cell: (u) =>
                  u.centre ? (
                    <>
                      {u.centre.name}
                      <div className="text-muted-foreground">/{u.centre.slug}</div>
                    </>
                  ) : (
                    <span className="text-muted-foreground italic">HQ</span>
                  ),
              },
              {
                key: "status",
                header: "Status",
                cell: (u) => (
                  <Badge variant={u.status === "active" ? "success" : "destructive"}>
                    {formatEnum(u.status)}
                  </Badge>
                ),
              },
              {
                key: "joined",
                header: "Joined",
                className: "text-xs text-muted-foreground",
                cell: (u) => formatDate(u.createdAt),
              },
              {
                key: "actions",
                header: "Actions",
                headerClassName: "text-right",
                className: "text-right",
                cell: (u) => (
                  <UserActions
                    user={{
                      id: u.id,
                      name: u.name,
                      email: u.email,
                      phone: u.phone ?? "",
                      role: u.role,
                      centreId: u.centreId,
                      status: u.status,
                    }}
                    centres={centres}
                    roles={ROLES as readonly string[]}
                    isSelf={u.id === session.userId}
                    canResetPassword={canResetPassword}
                  />
                ),
              },
            ]}
          />

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t pt-3 text-sm">
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Link
                    href={pageHref(page - 1)}
                    className="rounded-md border px-3 py-1.5 hover:bg-muted"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span className="rounded-md border px-3 py-1.5 text-muted-foreground opacity-50">
                    ← Previous
                  </span>
                )}
                {page < totalPages ? (
                  <Link
                    href={pageHref(page + 1)}
                    className="rounded-md border px-3 py-1.5 hover:bg-muted"
                  >
                    Next →
                  </Link>
                ) : (
                  <span className="rounded-md border px-3 py-1.5 text-muted-foreground opacity-50">
                    Next →
                  </span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

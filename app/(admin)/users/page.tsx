import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isRole } from "@/lib/roles";
import { scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { USER_STATUSES } from "@/lib/schemas/user-admin";
import { ROLES } from "@/lib/roles";
import { UserActions, UserSearchBar, NewUserCard } from "./client";
import { ApprovalQueue } from "./approval-queue";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  role?: string;
  centreId?: string;
  status?: string;
};

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

  const [users, centres, totalAll, pendingApprovals] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      take: 200,
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
    prisma.centre.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
    prisma.user.count(),
    // Spotlight: pending-approval users (staff hiring invites that have
    // been redeemed). Shown above the main list so admins don't have to
    // remember to filter for them.
    prisma.user.findMany({
      where: { status: "pending_approval" },
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-sm text-muted-foreground">
          HQ control · {totalAll} total · showing {users.length}. Edit role/centre/status, reset
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
          <CardTitle>Results ({users.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No users match.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-2">Name</th>
                    <th className="pb-2">Email</th>
                    <th className="pb-2">Phone</th>
                    <th className="pb-2">Role</th>
                    <th className="pb-2">Centre</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Joined</th>
                    <th className="pb-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t align-top">
                      <td className="py-2">
                        <div className="font-medium">{u.name}</div>
                      </td>
                      <td className="py-2 font-mono text-xs">{u.email}</td>
                      <td className="py-2 font-mono text-xs">
                        {u.phone ? (
                          <a href={`tel:${u.phone}`} className="hover:underline">{u.phone}</a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2">
                        <Badge variant="outline">{u.role.replaceAll("_", " ")}</Badge>
                      </td>
                      <td className="py-2 text-xs">
                        {u.centre ? (
                          <>
                            {u.centre.name}
                            <div className="text-muted-foreground">/{u.centre.slug}</div>
                          </>
                        ) : (
                          <span className="text-muted-foreground italic">HQ</span>
                        )}
                      </td>
                      <td className="py-2">
                        <Badge variant={u.status === "active" ? "success" : "destructive"}>
                          {u.status}
                        </Badge>
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">{formatDate(u.createdAt)}</td>
                      <td className="py-2 text-right">
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
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { StaffInviteManager } from "./invite-manager";

export const dynamic = "force-dynamic";

function canInvite(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "CENTRE_MANAGER";
}

export default async function StaffPage() {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);
  const where = centreWhere(centreId);

  const [staff, inviteLinks] = await Promise.all([
    prisma.staff.findMany({
      where,
      include: { user: { select: { name: true, email: true, phone: true, status: true } } },
      orderBy: { joiningDate: "desc" },
    }),
    canInvite(session.role)
      ? prisma.shortLink.findMany({
          where: { ...where, kind: "staff_hire" },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
  ]);

  const now = new Date();
  const invites = inviteLinks.map((l) => {
    let email: string | null = null;
    let role: string | null = null;
    try {
      const p = l.paramsJson ? JSON.parse(l.paramsJson) : {};
      email = p.email ?? null;
      role = p.role ?? null;
    } catch {
      /* ignore */
    }
    return {
      code: l.code,
      email,
      role,
      used: l.singleUse && l.redeemCount > 0,
      expired: !!l.expiresAt && l.expiresAt < now,
      createdAt: l.createdAt.toISOString(),
      expiresAt: l.expiresAt?.toISOString() ?? null,
      lastRedeemedAt: l.lastRedeemedAt?.toISOString() ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Staff</h1>
          <p className="text-sm text-muted-foreground">{staff.length} member{staff.length === 1 ? "" : "s"}</p>
        </div>
        <Button asChild>
          <Link href="/staff/new">
            <Plus className="h-4 w-4" /> Add staff
          </Link>
        </Button>
      </div>

      {canInvite(session.role) && <StaffInviteManager invites={invites} />}

      <Card>
        <CardHeader>
          <CardTitle>All staff</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="pb-2">Name</th>
                <th className="pb-2">Role</th>
                <th className="pb-2">Email</th>
                <th className="pb-2">Phone</th>
                <th className="pb-2">Joined</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="py-2 font-medium">{s.user.name}</td>
                  <td className="py-2">
                    <Badge variant="outline">{s.role.replaceAll("_", " ")}</Badge>
                  </td>
                  <td className="py-2">{s.user.email}</td>
                  <td className="py-2">{s.user.phone ?? "—"}</td>
                  <td className="py-2">{formatDate(s.joiningDate)}</td>
                  <td className="py-2">
                    <Badge variant={s.status === "active" ? "success" : "warning"}>{s.status}</Badge>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted-foreground">
                    No staff yet.{" "}
                    <Link href="/staff/new" className="text-primary underline">
                      Add the first one
                    </Link>
                    .
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

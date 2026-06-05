import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import { ownerCan } from "@/lib/owner-permissions";
import { TeamClient } from "./team-client";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const session = await getOwnerSession();
  const canManage = session ? ownerCan(session.role, "team.manage") : false;

  const users = await prisma.platformUser.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground">
          Platform-side users. Roles: <code className="text-foreground">OWNER_ADMIN</code> (full)
          {" · "}<code className="text-foreground">OWNER_EDITOR</code> (rename / contact)
          {" · "}<code className="text-foreground">OWNER_BILLING</code> (status / billing email).
        </p>
      </div>

      <TeamClient
        initial={users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))}
        canManage={canManage}
        currentUserId={session?.ownerId ?? null}
      />
    </div>
  );
}

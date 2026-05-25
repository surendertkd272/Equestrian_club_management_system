import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre, centreWhere } from "@/lib/tenancy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewTaskForm } from "./form";

export default async function NewTaskPage() {
  const session = (await getSession())!;
  if (!can(session.role, "task.assign")) redirect("/tasks");

  const centreId = scopeCentre(session);
  // SUPER_ADMIN needs to pick which centre this task belongs to — without
  // session.centreId pinned, the API rejects with "centreId required".
  // Centre-scoped roles always see a single centre, so we hide the picker.
  const isHQ = session.role === "SUPER_ADMIN" && !session.centreId;
  const [users, allCentres] = await Promise.all([
    prisma.user.findMany({
      where: { ...centreWhere(centreId), status: "active" },
      select: { id: true, name: true, role: true, centreId: true },
      orderBy: { name: "asc" },
    }),
    isHQ
      ? prisma.centre.findMany({
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>New task</CardTitle>
          <CardDescription>
            Assign operational work — stable cleaning, feeding, farrier, vet follow-up. Overdue tasks turn amber, and
            anything more than 24h overdue is auto-flagged "escalated".
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewTaskForm users={users} centres={allCentres} />
        </CardContent>
      </Card>
    </div>
  );
}

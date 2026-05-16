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
  const users = await prisma.user.findMany({
    where: { ...centreWhere(centreId), status: "active" },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });

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
          <NewTaskForm users={users} />
        </CardContent>
      </Card>
    </div>
  );
}

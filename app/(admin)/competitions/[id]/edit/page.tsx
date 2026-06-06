import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditCompetitionForm } from "./edit-competition-form";

export const dynamic = "force-dynamic";

export default async function EditCompetitionPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.role, "competition.manage")) redirect(`/competitions/${params.id}`);

  const centreId = scopeCentre(session);
  const comp = await prisma.competition.findUnique({ where: { id: params.id } });
  if (!comp) notFound();
  if (centreId && comp.centreId !== centreId) notFound();

  const initial = {
    name: comp.name,
    venue: comp.venue ?? "",
    scope: comp.scope,
    entryDeadline: comp.entryDeadline ? comp.entryDeadline.toISOString().slice(0, 10) : "",
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Edit competition</h1>
        <Link href={`/competitions/${comp.id}`} className="text-sm text-primary hover:underline">← Back</Link>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">{comp.name}</CardTitle></CardHeader>
        <CardContent><EditCompetitionForm competitionId={comp.id} initial={initial} /></CardContent>
      </Card>
    </div>
  );
}

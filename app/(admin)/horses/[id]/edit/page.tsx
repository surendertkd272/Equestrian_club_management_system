import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditHorseForm } from "./edit-horse-form";

export const dynamic = "force-dynamic";

// Edit the horse's core record + insurance. Allocations, vet/farrier history,
// and status transitions keep their own panels on the main profile page.
export default async function EditHorsePage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.role, "horse.manage")) redirect(`/horses/${params.id}`);

  const centreId = scopeCentre(session);
  const horse = await prisma.horse.findUnique({ where: { id: params.id } });
  if (!horse) notFound();
  if (centreId && horse.centreId !== centreId) notFound();

  const initial = {
    name: horse.name,
    breed: horse.breed ?? "",
    sex: horse.sex ?? "gelding",
    ageYears: horse.ageYears != null ? String(horse.ageYears) : "",
    heightHh: horse.heightHh != null ? String(horse.heightHh) : "",
    microchip: horse.microchip ?? "",
    ownership: horse.ownership ?? "club",
    stableNo: horse.stableNo ?? "",
    diet: horse.diet ?? "",
    status: horse.status,
    insurerName: horse.insurerName ?? "",
    insurancePolicyNo: horse.insurancePolicyNo ?? "",
    insurancePremium: horse.insurancePremium != null ? String(horse.insurancePremium) : "",
    insuranceValidFrom: horse.insuranceValidFrom ? horse.insuranceValidFrom.toISOString().slice(0, 10) : "",
    insuranceValidTo: horse.insuranceValidTo ? horse.insuranceValidTo.toISOString().slice(0, 10) : "",
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Edit {horse.name}</h1>
        <Link href={`/horses/${horse.id}`} className="text-sm text-primary hover:underline">← Back to profile</Link>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Horse details</CardTitle></CardHeader>
        <CardContent>
          <EditHorseForm horseId={horse.id} initial={initial} />
        </CardContent>
      </Card>
    </div>
  );
}

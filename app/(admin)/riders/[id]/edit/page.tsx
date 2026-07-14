import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForCentre, getOrgIdForSession } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { decryptPIISafe } from "@/lib/pii";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditRiderForm } from "./edit-rider-form";

export const dynamic = "force-dynamic";

// Edit page for the rider's core profile fields. Sub-flows (batch
// assignment, parent links, portal access, accreditations) stay on the
// main profile page where they have their own panels.
export default async function EditRiderPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.role, "rider.write")) redirect(`/riders/${params.id}`);

  const centreId = scopeCentre(session);
  const rider = await prisma.rider.findUnique({ where: { id: params.id } });
  if (!rider) notFound();
  if (centreId && rider.centreId !== centreId) notFound();
  // HQ tier has centreId=null, so the check above is skipped — bind them to
  // their own org so an Admin can't open another organisation's rider by id.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  if ((await getOrgIdForCentre(rider.centreId)) !== orgId) notFound();

  // Serialise dates to YYYY-MM-DD for the date inputs.
  const initial = {
    firstName: rider.firstName,
    lastName: rider.lastName,
    photoUrl: rider.photoUrl ?? "",
    dob: rider.dob.toISOString().slice(0, 10),
    joiningDate: rider.joiningDate.toISOString().slice(0, 10),
    placeOfBirth: rider.placeOfBirth ?? "",
    nationality: rider.nationality ?? "",
    gender: rider.gender ?? "",
    maritalStatus: rider.maritalStatus ?? "",
    aadhaarNo: decryptPIISafe(rider.aadhaarNo) ?? "", // decrypt for editing; re-encrypted on save
    aadhaarDocUrl: rider.aadhaarDocUrl ?? "",
    aadhaarBackDocUrl: rider.aadhaarBackDocUrl ?? "",
    mobile: rider.mobile,
    email: rider.email ?? "",
    preferredLanguage: rider.preferredLanguage ?? "",
    school: rider.school ?? "",
    education: rider.education ?? "",
    occupation: rider.occupation ?? "",
    addressPresent: rider.addressPresent ?? "",
    addressPermanent: rider.addressPermanent ?? "",
    pincode: rider.pincode ?? "",
    fatherName: rider.fatherName ?? "",
    fatherPhone: rider.fatherPhone ?? "",
    motherName: rider.motherName ?? "",
    motherPhone: rider.motherPhone ?? "",
    emergencyName: rider.emergencyName ?? "",
    emergencyPhone: rider.emergencyPhone ?? "",
    heightCm: rider.heightCm == null ? "" : String(rider.heightCm),
    weightKg: rider.weightKg == null ? "" : String(rider.weightKg),
    medicalNotes: rider.medicalNotes ?? "",
    allergies: rider.allergies ?? "",
    currentLevel: rider.currentLevel ?? "",
    stateRiderId: rider.stateRiderId ?? "",
    efiRiderId: rider.efiRiderId ?? "",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Edit Profile</h1>
          <p className="text-sm text-muted-foreground">
            {rider.firstName} {rider.lastName}
          </p>
        </div>
        <a
          href={`/riders/${rider.id}`}
          className="rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          Back to profile
        </a>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile Details</CardTitle>
        </CardHeader>
        <CardContent>
          <EditRiderForm id={rider.id} initial={initial} />
        </CardContent>
      </Card>
    </div>
  );
}

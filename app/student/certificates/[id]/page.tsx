import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getRiderForUser } from "@/lib/student";
import { FamilyCertificateView } from "@/components/certificates/family-certificate-view";

export const dynamic = "force-dynamic";

// A rider views / prints their own certificate. Redirects rather than giving
// a 404: app/student has a loading.tsx, which would turn that 404 into a 200.
export default async function StudentCertificatePage({ params }: { params: { id: string } }) {
  const session = await requireSession();
  if (session.role !== "RIDER") redirect("/student");
  const rider = await getRiderForUser(session.userId);
  if (!rider) redirect("/student");
  const view = await FamilyCertificateView({ certId: params.id, riderId: rider.id, backHref: "/student" });
  if (!view) redirect("/student");
  return view;
}

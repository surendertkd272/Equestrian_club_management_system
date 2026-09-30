import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { getChildIfLinked } from "@/lib/parent";
import { runWithRlsBypass } from "@/lib/tenant-context";
import { FamilyCertificateView } from "@/components/certificates/family-certificate-view";

export const dynamic = "force-dynamic";

// A parent views / prints their child's certificate.
export default async function ParentCertificatePage({ params }: { params: { id: string } }) {
  const session = await requireSession();
  if (session.role !== "PARENT") notFound();
  const owner = await runWithRlsBypass(() => prisma.certificate.findUnique({ where: { id: params.id }, select: { riderId: true } }));
  if (!owner) notFound();
  // Proves the child is theirs and binds the child's org for RLS.
  if (!(await getChildIfLinked(session.userId, owner.riderId))) notFound();
  const view = await FamilyCertificateView({ certId: params.id, riderId: owner.riderId, backHref: `/parent/${owner.riderId}` });
  if (!view) notFound();
  return view;
}

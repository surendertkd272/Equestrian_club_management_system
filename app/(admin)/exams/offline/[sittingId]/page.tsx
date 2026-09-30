import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { requireSession } from "@/lib/auth";
import { OfflineMarker } from "./offline-marker";

export const dynamic = "force-dynamic";

// Marking with no signal. Open this page once while online (the phone keeps a
// copy of it), take your riders, then mark in the arena; cards go up when the
// signal is back.
export default async function OfflineMarkingPage({ params }: { params: { sittingId: string } }) {
  const session = await requireSession();
  const sitting = await prisma.examSitting.findUnique({
    where: { id: params.sittingId },
    select: { id: true, centreId: true, panelJudgeIds: true, examiners: { select: { examinerId: true } } },
  });
  if (!sitting) notFound();
  if (await centreFence(session, sitting.centreId)) notFound();
  const inPool = sitting.examiners.some((x) => x.examinerId === session.userId);
  if (!inPool && !sitting.panelJudgeIds.includes(session.userId)) redirect(`/exams/sittings/${sitting.id}`);
  return <OfflineMarker sittingId={sitting.id} userId={session.userId} inPool={inPool} />;
}

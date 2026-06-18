import { redirect } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { getSession, shouldForceRotate } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pendingItems, parseWaived } from "@/lib/onboarding-items";
import { formatDate } from "@/lib/utils";
import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/topbar";
import { ReadOnlyBanner } from "@/components/shell/read-only-banner";
import { ImpersonationBanner } from "@/components/shell/impersonation-banner";
import { ConfirmHost } from "@/components/ui/confirm-dialog";
import { PromptHost } from "@/components/ui/prompt-dialog";
import { PwaInstallPrompt } from "@/components/shell/pwa-install-prompt";
import { getFeaturesForSession, getOrgIdForSession } from "@/lib/features-gate";
import { getStatusForSession } from "@/lib/readonly-gate";
import { parseEmergencyContacts } from "@/lib/json-narrow";
import { startOfDayInTz } from "@/lib/tz";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  // Force-rotate temp passwords before *anything* loads.
  if (await shouldForceRotate(session.userId)) redirect("/account/rotate");
  // Parents and riders don't belong in the admin shell — each has their own portal.
  if (session.role === "PARENT") redirect("/parent");
  if (session.role === "RIDER") redirect("/student");
  // SCHOOL_ADMINISTRATOR sees a read-only club view, distinct from the
  // full admin shell. Their dashboard surfaces only attendance, exams,
  // and skills for the riders attached to their club.
  if (session.role === "SCHOOL_ADMINISTRATOR") redirect("/school");

  // The HQ centre-picker list must be bounded to the signed-in admin's own
  // organisation — otherwise an HQ admin of one org sees every org's centres.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");

  // Pull centre + emergency contacts in one query. SUPER_ADMIN with no
  // centreId doesn't get a contacts strip (no single centre context).
  const [centreFull, orgCentres, unreadCount, features, orgStatus, userPhoto, myOnboarding] = await Promise.all([
    session.centreId
      ? prisma.centre.findUnique({
          where: { id: session.centreId },
          select: { id: true, name: true, slug: true, emergencyContactsJson: true, timezone: true },
        })
      : Promise.resolve(null),
    session.role === "SUPER_ADMIN" || session.role === "ADMIN"
      ? prisma.centre.findMany({ where: { orgId }, select: { id: true, name: true, slug: true } })
      : Promise.resolve(null),
    prisma.notification.count({ where: { userId: session.userId, readAt: null } }),
    getFeaturesForSession(session),
    getStatusForSession(session),
    prisma.user.findUnique({ where: { id: session.userId }, select: { photoUrl: true } }),
    prisma.employeeOnboarding.findFirst({ where: { createdUserId: session.userId, status: "approved" } }),
  ]);

  // The signed-in staff member's own pending onboarding items (if any).
  const myPending = myOnboarding
    ? pendingItems(myOnboarding as unknown as Record<string, unknown>, parseWaived(myOnboarding.waivedItemsJson))
    : [];
  // "Overdue" keys off the centre-local day so it doesn't flip at server-UTC midnight.
  const todayStart = startOfDayInTz(new Date(), centreFull?.timezone ?? "Asia/Kolkata");
  const docsOverdue = myOnboarding?.documentsDueAt ? myOnboarding.documentsDueAt < todayStart : false;

  const centre = centreFull
    ? { id: centreFull.id, name: centreFull.name, slug: centreFull.slug }
    : null;
  const centres = orgCentres ?? (centre ? [centre] : []);
  const emergencyContacts = parseEmergencyContacts(centreFull?.emergencyContactsJson);

  // HQ-tier admins' selected centre filter. Persisted in a cookie set by
  // /api/hq-centre when they pick from the topbar switcher. Pages can also
  // read this via scopeCentre() — the cookie is the single source of truth.
  const hqCentreCookie = cookies().get("ew_hq_centre")?.value;
  const hqCentreFilter = hqCentreCookie && hqCentreCookie !== "all" ? hqCentreCookie : null;

  return (
    <div className="flex min-h-screen">
      <Sidebar role={session.role} features={[...features]} />
      <div className="flex flex-1 flex-col">
        <TopBar
          session={session}
          centre={centre}
          allCentres={centres}
          unreadCount={unreadCount}
          emergencyContacts={emergencyContacts}
          photoUrl={userPhoto?.photoUrl ?? null}
          hqCentreFilter={hqCentreFilter}
        />
        <ImpersonationBanner impersonatedBy={session.impersonatedBy} userName={session.name} />
        <ReadOnlyBanner status={orgStatus} />
        {myPending.length > 0 && (
          <Link
            href="/my-documents"
            className={`block px-4 py-2 text-center text-sm hover:underline ${
              docsOverdue ? "bg-rose-700 text-white" : "bg-amber-500 text-amber-950"
            }`}
          >
            {docsOverdue ? "⚠ Overdue: " : ""}
            {myPending.length} onboarding item{myPending.length === 1 ? "" : "s"} pending
            {myOnboarding?.documentsDueAt ? ` · due ${formatDate(myOnboarding.documentsDueAt)}` : ""} — complete your documents →
          </Link>
        )}
        <main className="flex-1 bg-muted/40 p-3 sm:p-4 md:p-6 pb-20 md:pb-6">{children}</main>
        <ConfirmHost />
        <PromptHost />
        <PwaInstallPrompt />
      </div>
    </div>
  );
}


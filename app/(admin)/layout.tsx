import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession, shouldForceRotate } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/topbar";
import { ReadOnlyBanner } from "@/components/shell/read-only-banner";
import { ImpersonationBanner } from "@/components/shell/impersonation-banner";
import { ConfirmHost } from "@/components/ui/confirm-dialog";
import { PwaInstallPrompt } from "@/components/shell/pwa-install-prompt";
import { getFeaturesForSession } from "@/lib/features-gate";
import { getStatusForSession } from "@/lib/readonly-gate";

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

  // Pull centre + emergency contacts in one query. SUPER_ADMIN with no
  // centreId doesn't get a contacts strip (no single centre context).
  const [centreFull, orgCentres, unreadCount, features, orgStatus, userPhoto] = await Promise.all([
    session.centreId
      ? prisma.centre.findUnique({
          where: { id: session.centreId },
          select: { id: true, name: true, slug: true, emergencyContactsJson: true },
        })
      : Promise.resolve(null),
    session.role === "SUPER_ADMIN" || session.role === "ADMIN"
      ? prisma.centre.findMany({ select: { id: true, name: true, slug: true } })
      : Promise.resolve(null),
    prisma.notification.count({ where: { userId: session.userId, readAt: null } }),
    getFeaturesForSession(session),
    getStatusForSession(session),
    prisma.user.findUnique({ where: { id: session.userId }, select: { photoUrl: true } }),
  ]);

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
        <main className="flex-1 bg-muted/40 p-3 sm:p-4 md:p-6 pb-20 md:pb-6">{children}</main>
        <ConfirmHost />
        <PwaInstallPrompt />
      </div>
    </div>
  );
}

// Tolerant parser — bad JSON or legacy shapes return an empty list rather
// than crash the layout for every page. Accepts both string (legacy / tests)
// and JsonValue (native jsonb column).
function parseEmergencyContacts(json: unknown): { label: string; number: string; type: string }[] {
  if (json === null || json === undefined || json === "") return [];
  try {
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x === "object" && typeof x.label === "string" && typeof x.number === "string")
      .map((x) => ({
        label: String(x.label),
        number: String(x.number),
        type: typeof x.type === "string" ? x.type : "other",
      }));
  } catch {
    return [];
  }
}

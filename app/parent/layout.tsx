import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, shouldForceRotate } from "@/lib/auth";
import { getFeaturesForSession, getOrgIdForSession } from "@/lib/features-gate";
import { prisma } from "@/lib/prisma";
import { supportEmailFor } from "@/lib/contact";
import { getStatusForSession } from "@/lib/readonly-gate";
import { ReadOnlyBanner } from "@/components/shell/read-only-banner";
import { ImpersonationBanner } from "@/components/shell/impersonation-banner";
import { LogoutButton } from "./logout-button";

export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (await shouldForceRotate(session.userId)) redirect("/account/rotate");
  // Anyone other than a parent shouldn't be in this section.
  if (session.role !== "PARENT") redirect("/dashboard");

  // If the tenant has parent-portal turned off, render a static notice instead
  // of children. We deliberately don't redirect — that creates a login loop.
  //
  // An UNLINKED parent (no ParentLink yet) can't resolve an org, so the feature
  // set comes back empty — which previously showed a misleading "not on your
  // plan" notice. Distinguish the two: only gate when the org actually resolves
  // AND parent-portal is off. Unlinked → let the page render its real
  // "No Children Linked Yet" empty state.
  const orgStatus = await getStatusForSession(session);
  const orgId = await getOrgIdForSession(session);
  const enabled = orgId ? (await getFeaturesForSession(session)).has("parent-portal") : true;

  // Only needed for the "portal unavailable" message below.
  let supportEmail = "";
  if (!enabled) {
    const org = orgId
      ? await prisma.organisation.findUnique({ where: { id: orgId }, select: { supportEmail: true } })
      : null;
    supportEmail = supportEmailFor(org);
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <ImpersonationBanner impersonatedBy={session.impersonatedBy} userName={session.name} />
      <ReadOnlyBanner status={orgStatus} />
      <header className="border-b bg-card">
        <div className="container flex h-14 items-center justify-between">
          <Link href="/parent" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
              E
            </div>
            <div>
              <div className="text-sm font-bold leading-none">Equiwings</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Parent Portal</div>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Hi, {session.name}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="container py-6">
        {enabled ? children : (
          <div className="mx-auto max-w-md rounded-lg border bg-card p-6 text-sm">
            <h2 className="text-base font-semibold">Parent Portal Unavailable</h2>
            <p className="mt-1 text-muted-foreground">
              Your club hasn't enabled the parent portal on their plan. Please contact your
              club's manager, or email{" "}
              <a href={`mailto:${supportEmail}`} className="text-primary underline">{supportEmail}</a>.
            </p>
            <div className="mt-4">
              <LogoutButton />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

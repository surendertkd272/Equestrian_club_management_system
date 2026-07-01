import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { OnboardingWizard } from "./wizard";
import { bindRlsBypass } from "@/lib/tenant-context";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { centre?: string };
}) {
  bindRlsBypass(); // public-by-unguessable-id flow (no session to bind an org from)
  const slug = searchParams.centre;
  const centre = slug ? await prisma.centre.findUnique({ where: { slug } }) : null;

  if (!centre) {
    // A signed-in staff member who reached this page WITHOUT a slug (e.g. via a
    // dashboard / riders "Onboard a rider" CTA) shouldn't dead-end — send them
    // to their own centre's registration form. HQ on "all centres" (no centre
    // resolved) and public visitors (no session) fall through to the message.
    if (!slug) {
      const session = await getSession();
      let ownSlug: string | null = null;
      if (session) {
        try {
          const sCentreId = scopeCentre(session);
          if (sCentreId) {
            const own = await prisma.centre.findUnique({ where: { id: sCentreId }, select: { slug: true } });
            ownSlug = own?.slug ?? null;
          }
        } catch {
          // scopeCentre throws for a centre-less non-HQ user — fall through to the message.
        }
      }
      // redirect() throws NEXT_REDIRECT, so it must stay outside the try/catch above.
      if (ownSlug) redirect(`/onboarding?centre=${ownSlug}`);
    }
    // SECURITY: this page is public + RLS-bypassed and reached via an
    // unguessable per-centre link (?centre=<slug>). It must NEVER enumerate
    // centres — doing so leaks every tenant's club list to any visitor. With no
    // (or an unknown) slug, show a neutral message instead of a directory.
    // In development only, list centres as a convenience for local testing.
    const devCentres =
      process.env.NODE_ENV !== "production"
        ? await prisma.centre.findMany({ select: { slug: true, name: true } })
        : [];
    return (
      <main className="container max-w-md py-16 text-center">
        <h1 className="text-2xl font-bold">Registration Link Needed</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {slug
            ? "That registration link isn't valid. Please ask your club for the correct link."
            : "Open the registration link your club shared with you to start."}
        </p>
        {devCentres.length > 0 && (
          <div className="mt-8 rounded-md border border-dashed p-4 text-left">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Dev only — pick a centre
            </p>
            <ul className="mt-2 space-y-1">
              {devCentres.map((c) => (
                <li key={c.slug}>
                  <a className="text-primary underline" href={`/onboarding?centre=${c.slug}`}>
                    {c.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-secondary py-8">
      <div className="container max-w-2xl">
        <div className="mb-6 text-center">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">{centre.name}</div>
          <h1 className="mt-1 text-3xl font-bold">Rider Registration</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Replaces the paper GHRC Rider Registration Form + Indemnity Release.
          </p>
        </div>
        <OnboardingWizard centreSlug={centre.slug} centreName={centre.name} />
      </div>
    </main>
  );
}

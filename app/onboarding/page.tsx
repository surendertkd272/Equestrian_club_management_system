import { prisma } from "@/lib/prisma";
import { OnboardingWizard } from "./wizard";
import { bindRlsBypass } from "@/lib/tenant-context";

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
    const centres = await prisma.centre.findMany({ select: { slug: true, name: true } });
    return (
      <main className="container max-w-md py-16">
        <h1 className="text-2xl font-bold">Pick a centre</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Add <code>?centre=&lt;slug&gt;</code> to the URL, or pick one below.
        </p>
        <ul className="mt-6 space-y-2">
          {centres.map((c) => (
            <li key={c.slug}>
              <a className="text-primary underline" href={`/onboarding?centre=${c.slug}`}>
                {c.name}
              </a>
            </li>
          ))}
          {centres.length === 0 && (
            <li className="text-sm text-muted-foreground">No centres set up yet. Run <code>npm run db:seed</code>.</li>
          )}
        </ul>
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

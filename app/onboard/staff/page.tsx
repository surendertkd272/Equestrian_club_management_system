import { prisma } from "@/lib/prisma";
import { ONBOARDING_AGREEMENT, ONBOARDING_DECLARATION } from "@/lib/schemas/onboarding-staff";
import { OnboardingForm } from "./[token]/form";
import { bindRlsBypass } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

// Reusable per-club employee registration link: /onboard/staff?centre=<slug>.
// Distinct from /onboard/staff/<token> (one-time admin invite). The slug alone
// opens the form for unlimited applicants; each submission lands in the club's
// approval queue. Mirrors the rider public flow (/onboarding?centre=<slug>).

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-secondary px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <picture>
            <source srcSet="/equiwings-logo.png" type="image/png" />
            <img src="/equiwings-logo.svg" alt="Equiwings" className="h-10 w-auto" width={80} height={40} />
          </picture>
          <div>
            <div className="text-lg font-bold leading-none">Equiwings</div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Employee Registration</div>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border bg-card p-6 text-center shadow-sm">
      <h1 className="text-lg font-bold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

export default async function StaffSelfRegisterPage({
  searchParams,
}: {
  searchParams: { centre?: string };
}) {
  bindRlsBypass(); // public-by-slug flow (no session to bind an org from)
  const slug = searchParams.centre;
  const centre = slug
    ? await prisma.centre.findUnique({ where: { slug }, select: { name: true, slug: true } })
    : null;

  if (!centre) {
    // Never enumerate centres on a public page (leaks the tenant list). Neutral
    // message, same stance as the rider onboarding page.
    return (
      <Shell>
        <Notice
          title="Registration Link Needed"
          body="This employee registration link is missing its club. Please use the exact link your club shared with you."
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-4 rounded-lg border bg-card p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">{centre.name}</div>
        <h1 className="mt-1 text-xl font-bold">Employee Registration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fill this in to apply to join {centre.name}. The club will review your details before your account is created.
        </p>
      </div>
      <OnboardingForm
        centreSlug={centre.slug}
        centreName={centre.name}
        agreement={ONBOARDING_AGREEMENT}
        declaration={ONBOARDING_DECLARATION}
      />
    </Shell>
  );
}

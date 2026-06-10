import { prisma } from "@/lib/prisma";
import { hashOnboardingToken } from "@/lib/onboarding-token";
import { ONBOARDING_AGREEMENT, ONBOARDING_DECLARATION } from "@/lib/schemas/onboarding-staff";
import { OnboardingForm } from "./form";
import { bindRlsBypass } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

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

export default async function StaffOnboardPage({ params }: { params: { token: string } }) {
  bindRlsBypass(); // public-by-unguessable-id flow (no session to bind an org from)
  const row = await prisma.employeeOnboarding.findUnique({
    where: { tokenHash: hashOnboardingToken(params.token) },
    include: { centre: { select: { name: true } } },
  });

  if (!row) {
    return (
      <Shell>
        <Notice title="Link not found" body="This registration link is invalid. Please ask the club for a fresh link." />
      </Shell>
    );
  }
  if (row.expiresAt < new Date()) {
    return (
      <Shell>
        <Notice title="Link expired" body="This registration link has expired. Please request a new one from the club." />
      </Shell>
    );
  }
  if (row.status !== "draft") {
    return (
      <Shell>
        <Notice
          title="Already submitted"
          body="Thank you — your registration has been received and is with the club for review. They'll be in touch."
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <OnboardingForm
        token={params.token}
        centreName={row.centre.name}
        agreement={ONBOARDING_AGREEMENT}
        declaration={ONBOARDING_DECLARATION}
      />
    </Shell>
  );
}

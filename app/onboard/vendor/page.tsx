import { prisma } from "@/lib/prisma";
import { bindRlsBypass } from "@/lib/tenant-context";
import { VendorRegistrationForm } from "./form";

export const dynamic = "force-dynamic";

// Reusable per-club vendor registration link: /onboard/vendor?centre=<slug>.
// Public, slug-keyed (same shape as rider + staff self-registration).

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-secondary px-4 py-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex items-center gap-3">
          <picture>
            <source srcSet="/equiwings-logo.png" type="image/png" />
            <img src="/equiwings-logo.svg" alt="Equiwings" className="h-10 w-auto" width={80} height={40} />
          </picture>
          <div>
            <div className="text-lg font-bold leading-none">Equiwings</div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Vendor Registration</div>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

export default async function VendorRegisterPage({
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
    return (
      <Shell>
        <div className="rounded-lg border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold">Registration Link Needed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This vendor registration link is missing its club. Please use the exact link the club shared with you.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-4 rounded-lg border bg-card p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">{centre.name}</div>
        <h1 className="mt-1 text-xl font-bold">Vendor Registration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Register your business with {centre.name}. The club will review your details before adding you as a vendor.
        </p>
      </div>
      <VendorRegistrationForm centreSlug={centre.slug} centreName={centre.name} />
    </Shell>
  );
}

import Link from "next/link";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// The terminal state for an account whose organisation cannot be resolved.
//
// Every admin page — and the admin LAYOUT — fails closed on a null org with
// `if (!orgId) redirect("/dashboard")`. /dashboard is itself an admin page, so
// once resolution could genuinely return null (an HQ user with no User.orgId on
// an install with more than one organisation), that fail-closed became an
// infinite redirect: /dashboard → /dashboard, and every other page → /dashboard
// → /dashboard. The user met ERR_TOO_MANY_REDIRECTS on their landing page
// immediately after signing in successfully, with nothing to click.
//
// This page lives OUTSIDE the (admin) group on purpose: the admin layout is one
// of the redirectors, so a target inside it could never break the cycle.
export default async function NoOrganisationPage() {
  const session = await requireSession();

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-5 px-6 py-16">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Account not ready
        </p>
        <h1 className="mt-2 text-2xl font-bold">This account isn&apos;t attached to a club yet</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        You&apos;re signed in as <strong className="text-foreground">{session.name}</strong>, but the
        account isn&apos;t linked to an organisation, so there&apos;s nothing it can show you. Nothing
        is wrong with your password and no data is missing — a system administrator just needs to
        attach the account to a club.
      </p>

      <div className="rounded-lg border bg-card p-4 text-sm">
        <p className="font-medium">What to ask for</p>
        <p className="mt-1 text-muted-foreground">
          &ldquo;Please set my organisation on my staff account.&rdquo; Whoever manages your
          Equiwings account can do it in a few seconds; you&apos;ll be able to sign straight back in
          afterwards.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/account"
          className="rounded-md border bg-card px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Your account
        </Link>
        <Link
          href="/api/auth/logout"
          className="rounded-md border bg-card px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Sign out
        </Link>
      </div>
    </main>
  );
}

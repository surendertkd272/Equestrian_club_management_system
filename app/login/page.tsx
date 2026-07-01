import Link from "next/link";
import { LoginForm } from "./form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { currentDomain } from "@/lib/custom-domain";

export default async function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  // If the request arrived via a tenant's custom domain (e.g. academy.club.com)
  // greet the user with that tenant's name so it's clear which club they're
  // signing in to.
  const domain = await currentDomain();
  const tenantBranding = domain?.isCustomDomain ? domain.org : null;
  // Quick-pick test-account selector renders in dev by default. For the
  // current client UAT/test phase, deployed instances can opt in by setting
  // NEXT_PUBLIC_SHOW_TEST_DROPDOWN=1 in their Vercel env vars — that
  // exposes the dropdown + the "password is 1234" hint without changing
  // NODE_ENV. Drop the env var (or set it to 0) before going live.
  const devMode =
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_SHOW_TEST_DROPDOWN === "1";

  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          {!tenantBranding && (
            <picture>
              <source srcSet="/equiwings-logo.png" type="image/png" />
              <img
                src="/equiwings-logo.svg"
                alt="Equiwings"
                className="mx-auto mb-2 h-16 w-auto"
              />
            </picture>
          )}
          <CardTitle>Sign In</CardTitle>
          <CardDescription>
            {tenantBranding ? `${tenantBranding.name}` : "Equiwings Central Admin Panel"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={searchParams.next ?? "/dashboard"} quickPickEnabled={devMode && !tenantBranding} />
          <div className="mt-3 text-center text-xs">
            <Link href="/forgot-password" className="text-muted-foreground hover:underline">
              Forgot password?
            </Link>
          </div>
          {devMode && !tenantBranding && (
            <div className="mt-6 rounded-md border bg-muted p-3 text-xs text-muted-foreground">
              <div className="font-semibold text-foreground">Test build — all passwords are <code>password</code></div>
              <p className="mt-1">Pick any role from the dropdown above and tap Sign in.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { landingPathFor } from "@/components/shell/sidebar-nav";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  // "Back" home is role-dependent, and this is the same question the middleware
  // answers when it denies a page — so ask the same function rather than keep a
  // third copy of the portal-role list. The hand-rolled version here knew about
  // PARENT and RIDER and sent everyone else to /dashboard, which a school
  // administrator and an inspection officer are both refused.
  const homeHref = landingPathFor(session.role);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-card">
        <div className="container flex h-14 items-center justify-between">
          <Link href={homeHref} className="text-sm text-muted-foreground hover:text-foreground">
            ← Back
          </Link>
          <div className="text-sm font-semibold">Account settings</div>
          <span className="w-12" />
        </div>
      </header>
      <main className="container max-w-xl py-6">{children}</main>
    </div>
  );
}

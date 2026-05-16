import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  // "Back" home is role-dependent. Each portal owns its own home.
  const homeHref =
    session.role === "PARENT" ? "/parent"
    : session.role === "RIDER" ? "/student"
    : "/dashboard";

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

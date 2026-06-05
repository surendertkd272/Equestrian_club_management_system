import { redirect } from "next/navigation";
import Link from "next/link";
import { getOwnerSession } from "@/lib/owner-auth";
import { OwnerLogoutButton } from "./logout-button";
import { OwnerThemeToggle } from "./owner-theme-toggle";
import { ConfirmHost } from "@/components/ui/confirm-dialog";
import { Toaster } from "sonner";

// Server-side guard for everything under /owner/*. Owner sessions ride a
// separate cookie (ew_owner_session) so tenant middleware deliberately ignores
// them; the gate lives here instead.
export default async function OwnerProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await getOwnerSession();
  if (!session) redirect("/owner/login");

  return (
    // `dark` by default — the owner portal opens dark; the toggle swaps it for
    // `light`. Scoped here (not <html>) so it's independent of the tenant theme.
    <div id="owner-shell" className="dark min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/owner" className="text-sm font-semibold tracking-tight">
              Platform Owner
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/owner" className="hover:text-foreground">Dashboard</Link>
              <Link href="/owner/tenants" className="hover:text-foreground">Tenants</Link>
              <Link href="/owner/saas-invoices" className="hover:text-foreground">Invoices</Link>
              <Link href="/owner/billing" className="hover:text-foreground">Billing</Link>
              <Link href="/owner/pricing" className="hover:text-foreground">Pricing</Link>
              <Link href="/owner/announcements" className="hover:text-foreground">Announce</Link>
              <Link href="/owner/insights" className="hover:text-foreground">Insights</Link>
              <Link href="/owner/team" className="hover:text-foreground">Team</Link>
              <Link href="/owner/account" className="hover:text-foreground">Account</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              {session.name} <span className="text-muted-foreground">· {session.role}</span>
            </span>
            <OwnerThemeToggle />
            <OwnerLogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      <ConfirmHost />
      <Toaster richColors closeButton />
    </div>
  );
}

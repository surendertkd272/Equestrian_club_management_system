import { redirect } from "next/navigation";
import Link from "next/link";
import { getOwnerSession } from "@/lib/owner-auth";
import { OwnerLogoutButton } from "./logout-button";
import { ConfirmHost } from "@/components/ui/confirm-dialog";
import { Toaster } from "sonner";

// Server-side guard for everything under /owner/*. Owner sessions ride a
// separate cookie (ew_owner_session) so tenant middleware deliberately ignores
// them; the gate lives here instead.
export default async function OwnerProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await getOwnerSession();
  if (!session) redirect("/owner/login");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/owner" className="text-sm font-semibold tracking-tight">
              Platform Owner
            </Link>
            <nav className="flex items-center gap-4 text-sm text-slate-400">
              <Link href="/owner" className="hover:text-slate-100">Dashboard</Link>
              <Link href="/owner/tenants" className="hover:text-slate-100">Tenants</Link>
              <Link href="/owner/saas-invoices" className="hover:text-slate-100">Invoices</Link>
              <Link href="/owner/billing" className="hover:text-slate-100">Billing</Link>
              <Link href="/owner/pricing" className="hover:text-slate-100">Pricing</Link>
              <Link href="/owner/announcements" className="hover:text-slate-100">Announce</Link>
              <Link href="/owner/insights" className="hover:text-slate-100">Insights</Link>
              <Link href="/owner/team" className="hover:text-slate-100">Team</Link>
              <Link href="/owner/account" className="hover:text-slate-100">Account</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>
              {session.name} <span className="text-slate-500">· {session.role}</span>
            </span>
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

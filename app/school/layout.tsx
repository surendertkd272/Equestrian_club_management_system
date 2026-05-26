// School Administrator portal — separate from the staff admin shell.
// Designed for partner schools whose students train at one Equiwings club:
// they see attendance, exam levels, and skill progress for their riders,
// nothing else. No sidebar drawer or topbar features clutter the view.

import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export default async function SchoolLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "SCHOOL_ADMINISTRATOR") redirect("/dashboard");

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/equiwings-logo.png" alt="Equiwings" className="h-8 w-auto" />
            <div>
              <div className="text-sm font-semibold">School portal</div>
              <div className="text-xs text-muted-foreground">{session.name}</div>
            </div>
          </div>
          <form action="/api/auth/logout" method="POST">
            <Button type="submit" variant="outline" size="sm">
              <LogOut className="mr-1 h-4 w-4" /> Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

// School Administrator portal — separate from the staff admin shell.
// Designed for partner schools whose students train at one Equiwings club:
// they see attendance, exam levels, and skill progress for their riders,
// nothing else. No sidebar drawer or topbar features clutter the view.
//
// Kept in step with the other three authenticated shells (/student, /parent,
// (admin)): forced rotation of a temporary password, the impersonation banner,
// and the read-only banner. This portal was written before that pattern settled
// and had none of them — a school administrator handed a temp password by the
// club was never asked to change it, and their one write (approve/reject a
// sign-up) failed with a bare 403 when the org went past due, with nothing on
// screen to say why.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, shouldForceRotate } from "@/lib/auth";
import { getStatusForSession } from "@/lib/readonly-gate";
import { ReadOnlyBanner } from "@/components/shell/read-only-banner";
import { ImpersonationBanner } from "@/components/shell/impersonation-banner";
import { prisma } from "@/lib/prisma";
import { LogoutButton } from "./logout-button";
import { SchoolNav } from "./school-nav";

export default async function SchoolLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  // ?ended=1 so the login page can explain itself. Layouts and pages render
  // in parallel, so whichever redirect resolves first sets the Location —
  // keep this in step with requireSession() and assertRoute().
  if (!session) redirect("/login?ended=1");
  if (await shouldForceRotate(session.userId)) redirect("/account/rotate");
  if (session.role !== "SCHOOL_ADMINISTRATOR") redirect("/dashboard");

  const [orgStatus, openTasks] = await Promise.all([
    getStatusForSession(session),
    // What HQ is waiting on THEM for. Their own open requests are not counted:
    // a badge that lights up for something you raised yourself is noise, and
    // the reason to show one at all is that a task addressed to the school was
    // invisible until they happened to open the tab.
    session.centreId
      ? prisma.task.count({
          where: {
            centreId: session.centreId,
            assigneeId: session.userId,
            status: { not: "done" },
          },
        })
      : Promise.resolve(0),
  ]);

  return (
    <div className="min-h-screen bg-muted/40">
      <ImpersonationBanner impersonatedBy={session.impersonatedBy} userName={session.name} />
      <ReadOnlyBanner status={orgStatus} />
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          {/* At 390px this used to wrap to "School / portal / Anjali Verma"
              stacked beside the logo. The logo and the actions hold their size,
              the name is the part that gives way, and nothing wraps. */}
          <Link href="/school" className="flex min-w-0 items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/equiwings-logo.png" alt="Equiwings" className="h-8 w-auto shrink-0" />
            <div className="min-w-0">
              <div className="whitespace-nowrap text-sm font-semibold">School portal</div>
              <div className="truncate text-xs text-muted-foreground">{session.name}</div>
            </div>
          </Link>
          <div className="flex shrink-0 items-center gap-3 text-sm">
            {/* Both pages work for this role and neither was reachable from
                here — the user guide tells them to visit Account to change a
                password or set notifications, with nothing to click. */}
            <Link href="/account" className="text-muted-foreground hover:text-foreground">
              Account
            </Link>
            <Link href="/help" className="text-muted-foreground hover:text-foreground">
              Help
            </Link>
            <LogoutButton />
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4">
          <SchoolNav openTasks={openTasks} />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

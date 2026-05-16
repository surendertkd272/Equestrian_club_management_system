import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { RotateForm } from "./form";

// Forced-rotation gate. The login API redirects here when the user's
// mustChangePassword flag is true; on success the API clears the flag and
// we bounce them onward to their portal home. If they hit /account/rotate
// without the flag set, send them straight to their actual home.
export default async function ForcedRotatePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { mustChangePassword: true, role: true, name: true, email: true },
  });
  if (!me) redirect("/login");

  if (!me.mustChangePassword) {
    // Already rotated. Send them where they actually belong.
    const home =
      me.role === "PARENT" ? "/parent"
      : me.role === "RIDER" ? "/student"
      : "/dashboard";
    redirect(home);
  }

  const homeOnSuccess =
    me.role === "PARENT" ? "/parent"
    : me.role === "RIDER" ? "/student"
    : "/dashboard";

  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary p-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Pick a new password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome, {me.name}. You're signed in with a temporary password —
          please set a permanent one before continuing.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Signed in as <code className="rounded bg-muted px-1 py-0.5">{me.email}</code>
        </p>
        <div className="mt-4">
          <RotateForm homeOnSuccess={homeOnSuccess} />
        </div>
      </div>
    </main>
  );
}

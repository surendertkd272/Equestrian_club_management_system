import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SignOutEverywhereButton } from "./sign-out-everywhere-button";

export const dynamic = "force-dynamic";

// Account activity & session management. Reads the audit log for
// auth-related events on the signed-in user. Lets them see when/where
// they (or someone using their account) logged in and gives them a one-
// click "kick every session" button backed by User.tokenVersion.
export default async function ActivityPage() {
  const session = (await getSession())!;

  const events = await prisma.auditLog.findMany({
    where: {
      userId: session.userId,
      action: {
        in: [
          "auth.login",
          "auth.logout",
          "auth.signed_out_everywhere",
          "auth.email_verified",
          "auth.password_changed",
          "password.reset_redeemed",
          "owner.impersonation_started",
        ],
      },
    },
    orderBy: { at: "desc" },
    take: 50,
    select: { id: true, action: true, at: true, ip: true, userAgent: true, before: true, after: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Account Activity</h1>
      </div>

      <Card className="border-amber-300 bg-amber-50">
        <CardHeader>
          <CardTitle className="text-base">Sign Out Everywhere</CardTitle>
          <CardDescription>
            Invalidates every active session for your account — this browser, your phone, anywhere else.
            You'll be redirected to the login screen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutEverywhereButton />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Events</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px]">{e.action.replace("auth.", "").replace("password.", "pw.")}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(e.at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {e.ip ? <span className="font-mono">{e.ip}</span> : null}
                    {e.userAgent ? <span className="ml-2 hidden md:inline">{e.userAgent.slice(0, 80)}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

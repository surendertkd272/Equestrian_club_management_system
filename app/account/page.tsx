import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { mergePrefs } from "@/lib/notify-prefs";
import { AccountForm } from "./form";
import { NotifPrefsPanel } from "./notif-prefs-panel";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { centre: { select: { name: true } } },
  });
  if (!user) redirect("/login");

  return (
    <div className="space-y-6">
      <AccountForm
        initial={{
          name: user.name,
          email: user.email,
          phone: user.phone ?? "",
          role: user.role,
          centreName: user.centre?.name ?? null,
          photoUrl: user.photoUrl ?? null,
        }}
        endpoints={{
          profile: "/api/account/me",
          password: "/api/account/change-password",
        }}
      />
      <NotifPrefsPanel initial={mergePrefs(user.notifPrefsJson)} />
    </div>
  );
}

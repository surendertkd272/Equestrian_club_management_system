import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import { OwnerAccountForm } from "./form";
import { OwnerTotpPanel } from "./totp-panel";

export const dynamic = "force-dynamic";

export default async function OwnerAccountPage() {
  const session = await getOwnerSession();
  if (!session) redirect("/owner/login");

  const user = await prisma.platformUser.findUnique({
    where: { id: session.ownerId },
    select: { name: true, email: true, role: true, twoFactor: true },
  });
  if (!user) redirect("/owner/login");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-slate-400">Your platform-owner profile, password, and 2FA.</p>
      </div>
      <OwnerAccountForm initial={{ name: user.name, email: user.email, role: user.role }} />
      <OwnerTotpPanel enabled={user.twoFactor} />
    </div>
  );
}

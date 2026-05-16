import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { assertSessionFeature } from "@/lib/features-gate";

// HQ comparative dashboard is SUPER_ADMIN only and gated to the hq-dashboard
// feature (Enterprise). A non-super-admin would never have the sidebar link
// either, but we guard at the route level too.
export default async function HQDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "SUPER_ADMIN") redirect("/dashboard");
  await assertSessionFeature("hq-dashboard");
  return <>{children}</>;
}

import { assertSessionFeature } from "@/lib/features-gate";

export default async function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("approvals");
  return <>{children}</>;
}

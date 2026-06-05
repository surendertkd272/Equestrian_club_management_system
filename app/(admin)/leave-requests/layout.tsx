import { assertSessionFeature } from "@/lib/features-gate";

export default async function LeaveRequestsLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("leave-requests");
  return <>{children}</>;
}

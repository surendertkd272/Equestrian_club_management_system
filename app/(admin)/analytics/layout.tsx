import { assertSessionFeature } from "@/lib/features-gate";

export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("analytics");
  return <>{children}</>;
}

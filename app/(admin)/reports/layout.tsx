import { assertSessionFeature } from "@/lib/features-gate";

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("reports");
  return <>{children}</>;
}

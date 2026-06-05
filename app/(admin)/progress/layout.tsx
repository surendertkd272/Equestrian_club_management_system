import { assertSessionFeature } from "@/lib/features-gate";

export default async function ProgressLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("skill-tracking");
  return <>{children}</>;
}

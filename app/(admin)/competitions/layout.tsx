import { assertSessionFeature } from "@/lib/features-gate";

export default async function CompetitionsLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("competitions");
  return <>{children}</>;
}

import { assertSessionFeature } from "@/lib/features-gate";

export default async function TeamsLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("teams");
  return <>{children}</>;
}

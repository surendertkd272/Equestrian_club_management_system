import { assertSessionFeature } from "@/lib/features-gate";

export default async function InjuriesLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("injuries");
  return <>{children}</>;
}

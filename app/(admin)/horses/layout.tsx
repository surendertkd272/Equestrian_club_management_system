import { assertSessionFeature } from "@/lib/features-gate";

export default async function HorsesLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("horse-management");
  return <>{children}</>;
}

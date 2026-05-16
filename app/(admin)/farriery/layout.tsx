import { assertSessionFeature } from "@/lib/features-gate";

export default async function FarrieryLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("farriery");
  return <>{children}</>;
}

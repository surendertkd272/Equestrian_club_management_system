import { assertSessionFeature } from "@/lib/features-gate";

export default async function TackLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("inventory");
  return <>{children}</>;
}

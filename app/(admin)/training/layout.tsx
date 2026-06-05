import { assertSessionFeature } from "@/lib/features-gate";

export default async function TrainingLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("training-certs");
  return <>{children}</>;
}

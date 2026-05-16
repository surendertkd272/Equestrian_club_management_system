import { assertSessionFeature } from "@/lib/features-gate";

export default async function ExamsLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("external-exams");
  return <>{children}</>;
}

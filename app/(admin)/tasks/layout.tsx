import { assertSessionFeature } from "@/lib/features-gate";

export default async function TasksLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("tasks");
  return <>{children}</>;
}

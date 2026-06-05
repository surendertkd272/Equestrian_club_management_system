import { assertSessionFeature } from "@/lib/features-gate";

export default async function AttendanceLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("attendance");
  return <>{children}</>;
}

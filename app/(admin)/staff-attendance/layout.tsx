import { assertSessionFeature } from "@/lib/features-gate";

export default async function StaffAttendanceLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("staff-attendance");
  return <>{children}</>;
}

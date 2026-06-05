import { assertSessionFeature } from "@/lib/features-gate";

export default async function FacilityBookingsLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("facility-bookings");
  return <>{children}</>;
}

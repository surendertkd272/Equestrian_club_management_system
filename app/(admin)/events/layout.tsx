import { assertSessionFeature } from "@/lib/features-gate";

export default async function EventsLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("events");
  return <>{children}</>;
}

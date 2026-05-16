import { assertSessionFeature } from "@/lib/features-gate";

export default async function ConsumablesLayout({ children }: { children: React.ReactNode }) {
  // Consumables ride on the vet-records feature toggle — they're the first-aid
  // kit siblings of the medicine cabinet.
  await assertSessionFeature("vet-records");
  return <>{children}</>;
}

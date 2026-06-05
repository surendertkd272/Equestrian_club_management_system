import { assertSessionFeature } from "@/lib/features-gate";

export default async function ConsumablesLayout({ children }: { children: React.ReactNode }) {
  // Gate on the dedicated "consumables" feature — the same key the sidebar
  // uses. (Previously asserted "vet-records", which mismatched the sidebar and
  // 404'd the page for orgs that had consumables on but vet-records off.)
  await assertSessionFeature("consumables");
  return <>{children}</>;
}

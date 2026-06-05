import { assertSessionFeature } from "@/lib/features-gate";

export default async function CatalogLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("club-catalog");
  return <>{children}</>;
}

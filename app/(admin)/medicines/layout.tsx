import { assertSessionFeature } from "@/lib/features-gate";

export default async function MedicinesLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("vet-records");
  return <>{children}</>;
}

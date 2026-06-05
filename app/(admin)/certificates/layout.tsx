import { assertSessionFeature } from "@/lib/features-gate";

export default async function CertificatesLayout({ children }: { children: React.ReactNode }) {
  await assertSessionFeature("certificates");
  return <>{children}</>;
}

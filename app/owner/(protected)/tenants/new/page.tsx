import Link from "next/link";
import { OnboardingWizard } from "./wizard";

export default function NewTenantPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">
          <Link href="/owner/tenants" className="hover:underline">Tenants</Link>
          <span className="mx-1">/</span>
          <span>New</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Onboard a new tenant</h1>
        <p className="text-sm text-slate-400">
          Three steps. Org details → first centre → first super admin. Everything is created in
          one transaction; you get a one-time temp password to share at the end.
        </p>
      </div>
      <OnboardingWizard />
    </div>
  );
}

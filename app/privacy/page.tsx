import Link from "next/link";

export const metadata = {
  title: "Privacy Policy · Equiwings",
  description: "How Equiwings collects, uses, and protects your personal data.",
};

// ⚠️ SCAFFOLD — Lawyer review required before publishing.
// India-specific obligations under the Digital Personal Data Protection
// Act 2023 (DPDPA) plus standard SaaS practice. Replace placeholders in
// {{ }} and adjust the data-controller details before launch.

const LAST_UPDATED = "2026-05-01";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-sm leading-7 text-slate-800">
      <h1 className="mb-2 text-3xl font-bold">Privacy Policy</h1>
      <p className="mb-8 text-xs text-slate-500">Last updated: {LAST_UPDATED}</p>

      <section className="space-y-4">
        <h2 className="mt-6 text-xl font-semibold">1. Who we are</h2>
        <p>
          {"{{Legal entity name}}"} ("Equiwings", "we", "us") is an Indian private limited
          company registered at {"{{Registered address}}"}, India. We operate the
          Equiwings software-as-a-service platform that equestrian academies use
          to manage riders, horses, exams, and finances. The platform is the
          "Data Fiduciary" under the Digital Personal Data Protection Act 2023
          ("DPDPA") in respect of personal data we process on our own behalf,
          and a "Data Processor" in respect of personal data processed on
          behalf of the academies that subscribe to the platform.
        </p>

        <h2 className="mt-6 text-xl font-semibold">2. What personal data we process</h2>
        <p>We may process the following categories of personal data:</p>
        <ul className="list-disc pl-6">
          <li><strong>Account data:</strong> name, email, phone, role.</li>
          <li><strong>Rider profile:</strong> name, date of birth, gender, address, parent/guardian details, school, photo, Aadhaar number (when voluntarily provided).</li>
          <li><strong>Riding records:</strong> attendance, exam scores, skill progress, certificate serial numbers, competition placements.</li>
          <li><strong>Horse records (where relevant):</strong> ownership and care logs.</li>
          <li><strong>Financial data:</strong> invoices, payment references, GSTIN, billing address.</li>
          <li><strong>Communications:</strong> in-app, email, SMS, and WhatsApp messages sent through the platform.</li>
          <li><strong>Technical data:</strong> IP address, user-agent, session timestamps, audit-log entries.</li>
        </ul>

        <h2 className="mt-6 text-xl font-semibold">3. Children under 18</h2>
        <p>
          Many riders are minors. We capture verifiable parental consent at
          registration as required by DPDPA Section 9. Parents can withdraw
          consent any time by writing to {"{{privacy@equiwings.example}}"} or via the
          Account → Delete data flow in the parent portal. Withdrawal does
          not affect records the centre is legally required to retain
          (financial records under the Income Tax Act, for example).
        </p>

        <h2 className="mt-6 text-xl font-semibold">4. Why we process your data (purposes)</h2>
        <ul className="list-disc pl-6">
          <li>To operate the academy's training, exam, and payment workflows.</li>
          <li>To send class reminders, fee due notifications, exam results, and certificates.</li>
          <li>To meet legal obligations (tax records, payment reconciliation).</li>
          <li>To improve the service (aggregated, non-identifying analytics only).</li>
        </ul>

        <h2 className="mt-6 text-xl font-semibold">5. Lawful basis</h2>
        <p>
          We rely on (a) your consent at registration for processing personal
          data, (b) certain legitimate uses recognised by DPDPA Section 7
          (compliance with law, performance of a function), and (c) the
          subscribing academy's instructions where we act as a Data Processor.
        </p>

        <h2 className="mt-6 text-xl font-semibold">6. Sharing</h2>
        <ul className="list-disc pl-6">
          <li><strong>With the subscribing academy</strong> the rider belongs to — that's the operational use case.</li>
          <li><strong>With sub-processors</strong> who help us deliver the service: cloud hosting ({"{{Vercel / AWS region}}"}), email ({"{{SendGrid / SES}}"}), SMS ({"{{Twilio + DLT-registered Indian carriers}}"}), WhatsApp Business API ({"{{Meta provider}}"}), payment processing ({"{{Razorpay, Stripe}}"}).</li>
          <li><strong>With authorities</strong> when legally compelled (court order, statutory request).</li>
        </ul>
        <p>We do not sell personal data, ever.</p>

        <h2 className="mt-6 text-xl font-semibold">7. Where your data lives</h2>
        <p>
          Production data is stored on servers located in India ({"{{ap-south-1}}"} /
          {"{{Mumbai region}}"}). Backups are encrypted at rest. Some sub-processors
          (email/SMS/WhatsApp gateways) may briefly receive your data in
          transit; we choose providers with India-resident infrastructure where
          available.
        </p>

        <h2 className="mt-6 text-xl font-semibold">8. Retention</h2>
        <p>
          Operational data is retained while the academy's subscription is
          active plus the period the law requires us to keep financial records
          ({"{{6 years}}"} for invoices under the Income Tax Act). Audit logs are
          pruned after 2 years (configurable). When you request deletion, we
          schedule it for {"{{30 days}}"} from the request to allow cancellation;
          after that the personal data is hard-deleted and the audit-trail
          entries are anonymised.
        </p>

        <h2 className="mt-6 text-xl font-semibold">9. Your rights under DPDPA</h2>
        <ul className="list-disc pl-6">
          <li><strong>Access:</strong> request a copy of your data via Account → Export.</li>
          <li><strong>Correction:</strong> edit your profile directly, or write to the privacy contact below.</li>
          <li><strong>Erasure:</strong> Account → Delete account (subject to legal retention).</li>
          <li><strong>Grievance redressal:</strong> email {"{{grievance@equiwings.example}}"}. We will respond within {"{{15}}"} days.</li>
        </ul>

        <h2 className="mt-6 text-xl font-semibold">10. Security</h2>
        <p>
          We protect data with HTTPS in transit, encrypted backups, hashed
          passwords (bcrypt), two-factor authentication for owner accounts,
          rate-limited login + password-reset endpoints, content-security
          policy headers, and tenant-isolation in the database layer. No
          system is perfectly secure; if you suspect a breach, write to
          {" {{security@equiwings.example}}"} and we will investigate immediately.
        </p>

        <h2 className="mt-6 text-xl font-semibold">11. Changes to this policy</h2>
        <p>
          We may update this policy. Material changes are notified by email
          to the primary account holder at least 14 days before they take
          effect.
        </p>

        <h2 className="mt-6 text-xl font-semibold">12. Contact</h2>
        <p>
          Data Protection Officer: {"{{name}}"} · {"{{dpo@equiwings.example}}"} ·
          {"{{Registered address}}"}, India.
        </p>

        <p className="pt-8 text-xs text-slate-500">
          By using Equiwings you agree to this policy and our <Link href="/terms" className="text-primary underline">Terms of Service</Link>.
        </p>
      </section>
    </main>
  );
}

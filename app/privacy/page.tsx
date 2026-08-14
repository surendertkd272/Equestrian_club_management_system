import Link from "next/link";

export const metadata = {
  title: "Privacy Policy · Equiwings",
  description: "How Equiwings collects, uses, shares, and protects your personal data under India's Digital Personal Data Protection Act 2023.",
};

// ⚠️ Before publishing: have your data-protection counsel review this and
// fill the three real-world identifiers that we cannot invent for you —
// the legal entity name, the registered-office address, and the mailbox
// names behind the privacy / grievance / DPO contacts. Everything else is
// written to reflect how the platform actually works and the obligations of
// the Digital Personal Data Protection Act 2023 ("DPDP Act") and the Digital
// Personal Data Protection Rules 2025. Remaining placeholders are shown in
// [brackets] so they are impossible to miss; contact addresses now point at
// info@equiwings.com.

const LAST_UPDATED = "6 June 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-sm leading-7 text-slate-800">
      <h1 className="mb-2 text-3xl font-bold">Privacy Policy</h1>
      <p className="mb-8 text-xs text-slate-500">Last updated: {LAST_UPDATED}</p>

      <section className="space-y-4">
        <p>
          This policy explains how <strong>[Equiwings legal entity name]</strong>{" "}
          ("Equiwings", "we", "us", "our") collects, uses, shares, stores, and
          protects your personal data, and the rights you have over it under
          India's Digital Personal Data Protection Act 2023 (the "DPDP Act") and
          the Digital Personal Data Protection Rules 2025. Please read it
          alongside our{" "}
          <Link href="/terms" className="text-primary underline">Terms of Service</Link>.
        </p>

        <h2 className="mt-8 text-xl font-semibold">1. Who we are and our role</h2>
        <p>
          Equiwings is operated by <strong>[Equiwings legal entity name]</strong>,
          a company incorporated in India with its registered office at{" "}
          <strong>[Registered office address]</strong>. We provide a
          software-as-a-service platform that equestrian academies and clubs use
          to manage riders, horses, exams, fees, and certificates.
        </p>
        <p>
          Under the DPDP Act, "personal data" is any data about an individual who
          is identifiable by or in relation to that data; a "Data Principal" is
          the individual the data is about; and a "Data Fiduciary" is whoever
          decides why and how that data is processed.
        </p>
        <ul className="list-disc pl-6">
          <li>
            <strong>As a Data Processor:</strong> for the rider, parent, staff,
            and horse records that an academy enters to run its own operations,
            the academy is the Data Fiduciary and decides the purposes. We
            process that data only on the academy's documented instructions,
            under our agreement with it.
          </li>
          <li>
            <strong>As a Data Fiduciary:</strong> for the data we decide the
            purpose of ourselves — account administration, billing for the
            subscription, security, and improving the product — we are the Data
            Fiduciary and this policy governs directly.
          </li>
        </ul>
        <p>
          If your data was entered by an academy you belong to, that academy is
          your first point of contact for access or correction; we will support
          and, where required, act on its instructions.
        </p>

        <h2 className="mt-8 text-xl font-semibold">2. The personal data we process</h2>
        <ul className="list-disc pl-6">
          <li><strong>Account &amp; identity:</strong> name, email address, phone number, role, login credentials (passwords are stored only as salted hashes), and two-factor settings.</li>
          <li><strong>Rider profile:</strong> name, date of birth, age, gender, address, photograph, school, and parent/guardian contact details.</li>
          <li><strong>Government identifiers (only when you choose to provide them):</strong> Aadhaar, PAN, and bank/UPI details for payouts or KYC. We collect these only where needed and treat them as sensitive.</li>
          <li><strong>Training records:</strong> attendance, batch/lesson schedules, skill progression, exam score cards, certificate serial numbers.</li>
          <li><strong>Health &amp; safety records:</strong> rider injury logs and, for horses, veterinary, medication, and care records.</li>
          <li><strong>Horse records:</strong> ownership, allocations, vaccination/deworming/farriery logs, feed plans, and insurance details.</li>
          <li><strong>Financial data:</strong> invoices, fee plans, payment references, GSTIN, and billing address. Card and bank details for payments are handled by our payment processors — we do not store full card numbers.</li>
          <li><strong>Communications:</strong> in-app messages and the email, SMS, and WhatsApp notifications sent through the platform.</li>
          <li><strong>Technical &amp; audit data:</strong> IP address, browser/user-agent, session timestamps, and an audit log of significant actions, kept for security and accountability.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">3. Children's data</h2>
        <p>
          Many riders are below 18. The DPDP Act treats everyone under 18 as a
          child and requires verifiable consent from a parent or lawful guardian
          before a child's personal data is processed. Accordingly:
        </p>
        <ul className="list-disc pl-6">
          <li>A child's profile is created and consented to by a parent or guardian, whose identity and age we verify at the point of consent.</li>
          <li>We do not undertake tracking, behavioural monitoring, or targeted advertising directed at children, and we do not process children's data in any way likely to cause harm.</li>
          <li>A parent or guardian can review, correct, or withdraw consent for their child's data at any time (see sections 9–11).</li>
        </ul>
        <p>
          Withdrawal of consent does not affect records we or the academy are
          legally required to keep (for example, financial records under tax and
          companies law).
        </p>

        <h2 className="mt-8 text-xl font-semibold">4. Why we process your data</h2>
        <ul className="list-disc pl-6">
          <li>To run the academy's training, attendance, exam, and certificate workflows.</li>
          <li>To raise and reconcile fees and to process payments.</li>
          <li>To send operational notifications — class reminders, fee-due alerts, exam results, and certificates.</li>
          <li>To provide parent and rider portals with read access to the relevant rider's own records.</li>
          <li>To keep the service secure, prevent abuse, and maintain audit trails.</li>
          <li>To meet legal obligations (tax, GST, and record-keeping).</li>
          <li>To improve the service using aggregated, de-identified usage data only.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">5. The legal basis for processing</h2>
        <p>
          We process personal data on the basis of (a) your consent, given at
          registration or when you provide the data, for the purposes notified to
          you; (b) "certain legitimate uses" permitted by the DPDP Act, such as
          complying with a legal obligation or responding to a medical emergency;
          and (c) the instructions of the academy that subscribes to the platform,
          where we act as its Data Processor.
        </p>

        <h2 className="mt-8 text-xl font-semibold">6. Consent and how to withdraw it</h2>
        <p>
          Where we rely on consent, we ask for it through a clear notice in plain
          language that describes the data, the purpose, and how to exercise your
          rights. You may withdraw consent at any time — through the relevant
          setting in your account, or by writing to{" "}
          <a href="mailto:info@equiwings.com" className="text-primary underline">info@equiwings.com</a>.
          Withdrawing consent is as easy as giving it, and we will stop the
          related processing, except where the law requires or permits us to
          continue. Withdrawal does not make earlier, lawful processing invalid.
        </p>

        <h2 className="mt-8 text-xl font-semibold">7. Who we share data with</h2>
        <p>We never sell personal data. We share it only as follows:</p>
        <ul className="list-disc pl-6">
          <li><strong>The academy you belong to</strong> — this is the core purpose of the platform.</li>
          <li>
            <strong>Sub-processors who help us run the service</strong>, each
            bound by contract to use the data only for that purpose:
            <ul className="mt-1 list-[circle] pl-6">
              <li><strong>Vercel</strong> — application hosting and content delivery.</li>
              <li><strong>Supabase</strong> — managed PostgreSQL database and encrypted backups, hosted in the Mumbai (ap-south-1) region.</li>
              <li><strong>Razorpay and/or Stripe</strong> — payment processing.</li>
              <li><strong>SendGrid</strong> — transactional email delivery.</li>
              <li><strong>Twilio</strong> (via DLT-registered Indian carriers) — SMS delivery.</li>
              <li><strong>Meta Platforms</strong> — WhatsApp Business Cloud API for WhatsApp notifications.</li>
            </ul>
          </li>
          <li><strong>Government agencies or authorities</strong> when we are legally required to disclose (for example, under a valid court order or statutory request).</li>
          <li><strong>A successor entity</strong> in the event of a merger, acquisition, or reorganisation, subject to this policy.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">8. Where your data is stored</h2>
        <p>
          The primary database and backups are hosted in India (Supabase, Mumbai
          / ap-south-1 region). Static assets are served through a global content
          delivery network for performance, and some communication gateways
          (email, SMS, and WhatsApp) necessarily transmit message content through
          their own infrastructure to deliver it. We do not transfer personal data
          to any country or territory restricted by the Central Government under
          the DPDP Act.
        </p>

        <h2 className="mt-8 text-xl font-semibold">9. How long we keep it</h2>
        <p>
          We keep operational data for as long as the academy's subscription is
          active and you maintain an account. After that, we retain it only as
          long as needed for the purpose, or as the law requires — financial and
          tax records, for example, are kept for the period mandated by the
          Income Tax Act and the Companies Act 2013 (up to eight years). Audit
          logs are pruned after two years. When you ask us to delete your data,
          we schedule deletion 30 days from the request (so an accidental request
          can be reversed), after which the personal data is permanently deleted
          and any retained audit entries are anonymised.
        </p>

        <h2 className="mt-8 text-xl font-semibold">10. Your rights as a Data Principal</h2>
        <p>The DPDP Act gives you the right to:</p>
        <ul className="list-disc pl-6">
          <li><strong>Access</strong> — obtain a summary of the personal data we process about you and how we process it.</li>
          <li><strong>Correction and updating</strong> — have inaccurate or incomplete data corrected or completed.</li>
          <li><strong>Erasure</strong> — have your personal data erased where it is no longer needed for the purpose and the law does not require us to keep it.</li>
          <li><strong>Nomination</strong> — nominate another individual to exercise your rights on your behalf in the event of death or incapacity.</li>
          <li><strong>Grievance redressal</strong> — have any grievance addressed by us before approaching the Data Protection Board (section 12).</li>
          <li><strong>Withdraw consent</strong> — at any time, as described in section 6.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">11. How to exercise your rights</h2>
        <p>
          You can do most of this yourself in the app: edit your profile to
          correct it, use Account → Export to obtain a copy, and use Account →
          Delete to request erasure. You can also write to{" "}
          <a href="mailto:info@equiwings.com" className="text-primary underline">info@equiwings.com</a>.
          We will verify your identity before acting and respond within the
          timelines required by law. If an academy entered your data, we may need
          to route your request through it as the Data Fiduciary.
        </p>
        <p>
          You also have a duty under the DPDP Act not to file false or frivolous
          complaints and not to impersonate another person when exercising rights.
        </p>

        <h2 className="mt-8 text-xl font-semibold">12. Grievance Officer &amp; the Data Protection Board</h2>
        <p>
          If you have a concern about how your data is handled, contact our
          Grievance Officer first:
        </p>
        <p className="rounded-lg border border-border bg-muted p-4">
          <strong>Grievance Officer</strong><br />
          [Name of Grievance Officer]<br />
          <a href="mailto:info@equiwings.com" className="text-primary underline">info@equiwings.com</a><br />
          [Registered office address], India
        </p>
        <p>
          We will acknowledge your grievance on receipt and resolve it within 90
          days. If you are not satisfied with our response, you may make a
          complaint to the Data Protection Board of India established under the
          DPDP Act.
        </p>

        <h2 className="mt-8 text-xl font-semibold">13. How we keep data secure</h2>
        <p>
          We apply reasonable security safeguards, including encryption in transit
          (HTTPS), encrypted backups, salted password hashing, two-factor
          authentication for privileged accounts, rate-limited login and
          password-reset endpoints, security headers, role-based access control,
          and tenant isolation at the database layer. No system is perfectly
          secure; if you believe your account or data has been compromised, write
          to{" "}
          <a href="mailto:info@equiwings.com" className="text-primary underline">info@equiwings.com</a>{" "}
          and we will investigate promptly.
        </p>

        <h2 className="mt-8 text-xl font-semibold">14. Personal data breaches</h2>
        <p>
          If a personal data breach occurs, we will notify the Data Protection
          Board of India and each affected Data Principal in the manner and within
          the timelines required by the DPDP Act and the DPDP Rules 2025,
          describing the nature of the breach, its likely consequences, and the
          measures we are taking. Where we act as a Data Processor, we will also
          inform the relevant academy without undue delay.
        </p>

        <h2 className="mt-8 text-xl font-semibold">15. Cookies and similar technologies</h2>
        <p>
          We use strictly necessary cookies to keep you signed in and to secure
          your session. We do not use third-party advertising or cross-site
          tracking cookies.
        </p>

        <h2 className="mt-8 text-xl font-semibold">16. Changes to this policy</h2>
        <p>
          We may update this policy from time to time. We will notify the primary
          account holder by email at least 14 days before material changes take
          effect, and we will update the "Last updated" date above.
        </p>

        <h2 className="mt-8 text-xl font-semibold">17. Contact us</h2>
        <p>
          For any privacy question, or to reach our Data Protection Officer:
        </p>
        <p className="rounded-lg border border-border bg-muted p-4">
          <strong>Data Protection Officer</strong><br />
          [Name of Data Protection Officer]<br />
          <a href="mailto:info@equiwings.com" className="text-primary underline">info@equiwings.com</a><br />
          [Equiwings legal entity name]<br />
          [Registered office address], India
        </p>

        <p className="pt-8 text-xs text-slate-500">
          By using Equiwings you agree to this policy and our{" "}
          <Link href="/terms" className="text-primary underline">Terms of Service</Link>.
        </p>
      </section>
    </main>
  );
}

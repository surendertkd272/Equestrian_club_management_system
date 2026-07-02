import Link from "next/link";

export const metadata = {
  title: "Terms of Service · Equiwings",
  description: "Terms governing your use of Equiwings.",
};

// ⚠️ SCAFFOLD — Lawyer review required before publishing. Replace
// placeholders in {{ }} and revise to match the live commercial offer.

const LAST_UPDATED = "2026-05-01";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-sm leading-7 text-slate-800">
      <h1 className="mb-2 text-3xl font-bold">Terms of Service</h1>
      <p className="mb-8 text-xs text-slate-500">Last updated: {LAST_UPDATED}</p>

      <section className="space-y-4">
        <h2 className="mt-6 text-xl font-semibold">1. Acceptance</h2>
        <p>
          These Terms ("<strong>Terms</strong>") form a contract between you
          ("<strong>Customer</strong>", "<strong>you</strong>") and {"{{Legal entity name}}"}
          ("<strong>Equiwings</strong>", "<strong>we</strong>") and govern your use
          of the Equiwings platform (the "<strong>Service</strong>"). By signing
          up, you agree to them on behalf of yourself and the academy you
          represent. If you do not agree, do not use the Service.
        </p>

        <h2 className="mt-6 text-xl font-semibold">2. Subscription &amp; payment</h2>
        <ul className="list-disc pl-6">
          <li>The Service is billed monthly or annually in INR via Razorpay or Stripe.</li>
          <li>All fees are exclusive of GST; GST at the prevailing rate ({"{{18%}}"}) is added at invoice time.</li>
          <li>Payment is due in advance; failed payments move the account to "past_due" with a 7-day grace, then to "suspended" (read-only) until billing is restored.</li>
          <li>Refunds are not provided for partial periods. You may cancel any time; cancellation takes effect at the end of the paid period.</li>
        </ul>

        <h2 className="mt-6 text-xl font-semibold">3. Trial</h2>
        <p>
          Trials last {"{{14}}"} days and convert automatically unless you
          cancel. Trial data is preserved when you convert; cancelled trials
          are deleted after {"{{30}}"} days of inactivity.
        </p>

        <h2 className="mt-6 text-xl font-semibold">4. Acceptable use</h2>
        <p>You agree NOT to:</p>
        <ul className="list-disc pl-6">
          <li>Use the Service for any illegal activity.</li>
          <li>Upload data you do not have lawful authority to process.</li>
          <li>Reverse-engineer, scrape, or attempt unauthorised access.</li>
          <li>Send unsolicited communications through our notification channels.</li>
        </ul>

        <h2 className="mt-6 text-xl font-semibold">5. Your data; our data</h2>
        <p>
          You retain ownership of all data you upload. We process it on your
          instructions as a Data Processor under DPDPA, except where we use
          it for security, billing, or aggregated, anonymised analytics. See
          our <Link href="/privacy" className="text-primary underline">Privacy Policy</Link> for
          details.
        </p>

        <h2 className="mt-6 text-xl font-semibold">6. Service levels</h2>
        <p>
          We target {"{{99.5%}}"} monthly uptime, measured against
          <Link href="https://status.equiwings.example" className="text-primary underline">{" "}our status page</Link>. We do not guarantee uninterrupted service. Planned
          maintenance is announced at least 48 hours in advance whenever practicable.
        </p>

        <h2 className="mt-6 text-xl font-semibold">7. Security</h2>
        <p>
          We use industry-standard safeguards (HTTPS in transit, encryption
          at rest, hashed passwords, two-factor authentication for owner
          access, principle-of-least-privilege roles). You are responsible
          for safeguarding your own credentials.
        </p>

        <h2 className="mt-6 text-xl font-semibold">8. Suspension &amp; termination</h2>
        <p>
          We may suspend or terminate the Service if (a) you breach these
          Terms, (b) payment is overdue beyond the grace period, or (c) we
          are legally compelled to. On termination you can export your
          data for {"{{30}}"} days; afterwards we delete it (subject to legal
          retention obligations).
        </p>

        <h2 className="mt-6 text-xl font-semibold">9. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, our aggregate liability
          for any claim arising out of or related to the Service is limited
          to the fees you paid us in the {"{{12 months}}"} preceding the claim.
          We are not liable for indirect, incidental, or consequential
          damages.
        </p>

        <h2 className="mt-6 text-xl font-semibold">10. Indemnity</h2>
        <p>
          You indemnify us against third-party claims arising out of (a)
          data you upload, (b) your or your users' breach of these Terms,
          and (c) your violation of any law in connection with the Service.
        </p>

        <h2 className="mt-6 text-xl font-semibold">11. Confidentiality</h2>
        <p>
          Each party will protect the other's confidential information with
          reasonable care and use it only for the purposes of the Service.
        </p>

        <h2 className="mt-6 text-xl font-semibold">12. Governing law &amp; dispute resolution</h2>
        <p>
          These Terms are governed by Indian law. Disputes are subject to
          the exclusive jurisdiction of the courts of {"{{Bengaluru}}"}, India.
          Before filing suit, the parties will attempt mediation in good
          faith for at least 30 days.
        </p>

        <h2 className="mt-6 text-xl font-semibold">13. Changes</h2>
        <p>
          We may revise these Terms. Material changes are emailed to the
          primary account holder at least {"{{14}}"} days before they take
          effect. Continued use after the effective date is acceptance.
        </p>

        <h2 className="mt-6 text-xl font-semibold">14. Contact</h2>
        <p>
          {"{{Legal entity name}}"} · {"{{Registered address}}"} · India ·
          {" info@equiwings.com"}
        </p>
      </section>
    </main>
  );
}

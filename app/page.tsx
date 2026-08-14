import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

// Public marketing landing for Equiwings — the SaaS product. Visitors:
//   • Existing tenant users → Sign in
//   • Prospective tenant (academy owner) → "Book a demo" or /pricing
//   • Existing rider/parent of a tenant → Centre-specific signup link
// Copy is intentionally India-equestrian-specific. Replace screenshots
// + testimonials before launch.

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-background to-background">
      {/* Nav */}
      <header className="border-b bg-card/60 backdrop-blur">
        <div className="container mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-bold tracking-tight">Equiwings</Link>
          <nav className="hidden gap-6 text-sm md:flex">
            <Link href="#features" className="hover:text-primary">Features</Link>
            <Link href="/pricing" className="hover:text-primary">Pricing</Link>
            <Link href="#faq" className="hover:text-primary">FAQ</Link>
            <Link href="/privacy" className="hover:text-primary">Privacy</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline"><Link href="/login">Sign In</Link></Button>
            <Button asChild size="sm"><Link href="/pricing">Start Free Trial</Link></Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="container mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="max-w-3xl">
          <div className="inline-block rounded-full bg-warning-soft px-3 py-1 text-xs font-semibold text-warning-foreground">
            BUILT IN INDIA · FOR INDIAN EQUESTRIAN CLUBS
          </div>
          <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-6xl">
            The operating system for your equestrian academy.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            Riders, horses, exams, fees, certificates — every register, log book,
            and ledger your club runs on, all in one panel. Replaces six paper systems and
            three WhatsApp groups.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg"><Link href="/pricing">Start 14-Day Free Trial</Link></Button>
            <Button asChild size="lg" variant="outline"><Link href="mailto:info@equiwings.com?subject=Demo%20request">Book a Demo</Link></Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">No credit card needed. Cancel any time.</p>
        </div>
      </section>

      {/* Feature grid */}
      <section id="features" className="container mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-3xl font-bold">Everything an Indian academy needs.</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">Not generic CRM — workflows built for our sport.</p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-6 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wider text-warning-foreground">{f.group}</div>
              <div className="mt-2 text-lg font-semibold">{f.title}</div>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why Equiwings */}
      <section className="border-y bg-muted/40 py-16">
        <div className="container mx-auto max-w-6xl px-6">
          <h2 className="text-3xl font-bold">Why clubs switch.</h2>
          <ul className="mt-8 grid gap-4 md:grid-cols-2">
            {REASONS.map((r) => (
              <li key={r} className="flex items-start gap-3 rounded-lg bg-card p-4 shadow-sm">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <span className="text-sm text-foreground">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="container mx-auto max-w-3xl px-6 py-16">
        <h2 className="text-3xl font-bold">Common questions.</h2>
        <dl className="mt-8 space-y-6">
          {FAQ.map((q) => (
            <div key={q.q}>
              <dt className="font-semibold">{q.q}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{q.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* CTA */}
      <section className="bg-slate-900 py-16 text-white">
        <div className="container mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-3xl font-bold">Run your academy the way you've been meaning to.</h2>
          <p className="mt-3 text-slate-300">Set it up in an afternoon. 14-day trial. No card required.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" variant="default"><Link href="/pricing">See Pricing</Link></Button>
            <Button asChild size="lg" variant="outline" className="border-slate-600 bg-transparent text-white hover:bg-slate-800"><Link href="mailto:info@equiwings.com?subject=Demo%20request">Talk to Sales</Link></Button>
          </div>
        </div>
      </section>

      <footer className="border-t bg-card">
        <div className="container mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-muted-foreground">
          <div>© {new Date().getFullYear()} Equiwings · Made in India</div>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
            <Link href="mailto:info@equiwings.com" className="hover:text-foreground">Support</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

const FEATURES = [
  { group: "Athletes", title: "Rider Register + Skill Tracking", body: "EFI-style level progression, per-discipline skill heatmaps, attendance auto-rolled across batches." },
  { group: "Horses", title: "Stable Management", body: "Allocations, vaccinations, deworming, dental, farriery, feed plans, insurance expiry alerts." },
  { group: "Exams", title: "Multi-Judge Exams", body: "Rubric templates, per-judge score cards, auto-issued QR-verified certificates on pass." },
  { group: "Money", title: "Fees, Payments, GST", body: "Registration + monthly invoices, GST tracking, cash/Razorpay/Stripe collection, expense P&L." },
  { group: "Parents", title: "Parent + Student Portals", body: "Parents see attendance %, exam results, lesson schedule. Students see their own progress." },
  { group: "Staff", title: "Coach + Vet + Groom", body: "Role-based access, staff attendance, leave, training records — 17 distinct roles supported." },
  { group: "Health", title: "Vet Records + Injury Log", body: "Per-horse medicine usage, withdrawal periods, cold-chain tracking, separate horse + rider injury logs." },
  { group: "HQ", title: "Multi-Centre Dashboard", body: "Compare attendance %, pass rate, unpaid invoices, riders/staff/horses across every centre in your chain." },
];

const REASONS = [
  "Built for the Indian regulator — DPDPA-ready, GST on every invoice, DLT-template-aware SMS.",
  "WhatsApp + SMS + email out of the box for class reminders, fee dues, and exam results.",
  "QR-verified certificates that parents and federations can scan to confirm.",
  "One panel for HQ + every centre — never juggle four Excel sheets again.",
  "Designed for spotty rural connectivity — service worker caches the basics offline.",
];

const FAQ = [
  { q: "How long does setup take?", a: "Most academies are live in under an hour. The onboarding wizard creates your tenant, centre, and admin account; sample fee plans and skill catalogs are seeded for you." },
  { q: "Can my parents and students log in?", a: "Yes — separate portals for parents and rider/students, with read-only access to their own children/themselves. Activation is opt-in per rider." },
  { q: "Do you charge in INR?", a: "Yes. We bill in INR with GST. Razorpay (UPI mandate, cards, netbanking) is the default; Stripe is available for clubs with international cards." },
  { q: "What happens to my data if I leave?", a: "Export everything as CSV (riders, horses, invoices, audit logs) any time. On cancellation we keep your data for 30 days in case you change your mind, then delete it (subject to legal retention rules)." },
  { q: "Do you support multi-centre chains?", a: "Yes — that's the design. One Organisation, many Centres, one HQ-level comparative dashboard." },
];

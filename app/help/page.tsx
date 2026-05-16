import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const metadata = {
  title: "Help · Equiwings",
  description: "How-to guides and FAQs for using Equiwings.",
};

// Public help index. Articles live as static MDX/markdown files at
// /help/<slug>/page.tsx; this is the landing page that organises them
// into 5 topical sections. Build out individual articles over time —
// the index degrades gracefully when articles are missing (404).

const SECTIONS = [
  {
    title: "Getting started",
    articles: [
      { slug: "first-day-checklist", title: "Your first day with Equiwings", summary: "Set up centres, batches, and your first 10 riders in under an hour." },
      { slug: "invite-staff", title: "Invite coaches, vets, and grooms", summary: "Role-based access for the 17 staff roles we support." },
      { slug: "rider-onboarding", title: "Onboarding parents + riders", summary: "Share your centre's signup link, or import a CSV." },
    ],
  },
  {
    title: "Training & exams",
    articles: [
      { slug: "schedule-lessons", title: "Scheduling lessons + horse allocation", summary: "Pair riders with horses, mark sessions complete." },
      { slug: "track-skills", title: "Skill progress + level promotions", summary: "Per-rider heatmaps, mastery tracking, promotion criteria." },
      { slug: "running-exams", title: "Running multi-judge exams", summary: "Rubric templates, score cards, certificates on pass." },
    ],
  },
  {
    title: "Competitions & events",
    articles: [
      { slug: "host-competition", title: "Host a competition end-to-end", summary: "Classes, entries, scoring, live scoreboard, certificates." },
      { slug: "discipline-scoring", title: "Dressage / Jumping / Eventing / Gymkhana scoring", summary: "Discipline-specific math and tie-breaks." },
      { slug: "accreditations", title: "Track EFI / BHS / FEI memberships", summary: "Federation credentials per rider with expiry alerts." },
    ],
  },
  {
    title: "Horse care",
    articles: [
      { slug: "horse-health-schedules", title: "Vaccinations, deworming, dental", summary: "One schedule, one nextDueAt sweep, alerts before each lapse." },
      { slug: "feed-plans", title: "Per-horse feeding plans", summary: "Time-slot rations, dietary notes for vet review." },
      { slug: "insurance", title: "Horse insurance + expiry tracking", summary: "Policy fields and the expiry alert sweep." },
    ],
  },
  {
    title: "Money & billing",
    articles: [
      { slug: "fee-plans", title: "Fee plans + automatic invoicing", summary: "Monthly fees, registration, exam fees." },
      { slug: "razorpay-setup", title: "Razorpay subscription setup", summary: "Mandate authorisation flow for tenants on autopay." },
      { slug: "saas-invoices", title: "Your platform invoices", summary: "Print/save the SaaS invoices we issue to you." },
      { slug: "data-export", title: "Export your data (DPDPA)", summary: "One-click full-org export — JSON bundle." },
    ],
  },
];

export default function HelpIndex() {
  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="container mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-bold">Equiwings</Link>
          <nav className="hidden gap-6 text-sm md:flex">
            <Link href="/pricing" className="hover:text-primary">Pricing</Link>
            <Link href="/help" className="font-semibold">Help</Link>
            <Link href="mailto:support@equiwings.example" className="hover:text-primary">Contact</Link>
          </nav>
        </div>
      </header>

      <section className="container mx-auto max-w-5xl px-6 py-16">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-bold">Help & guides</h1>
          <p className="mt-3 text-slate-600">
            Practical how-to articles for everyday Equiwings tasks. Can't find what you need?
            Email <a href="mailto:support@equiwings.example" className="text-primary underline">support@equiwings.example</a> —
            we read every message.
          </p>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {SECTIONS.map((section) => (
            <Card key={section.title} className="border bg-white">
              <CardHeader>
                <CardTitle className="text-base">{section.title}</CardTitle>
                <CardDescription className="text-slate-500">
                  {section.articles.length} articles
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {section.articles.map((a) => (
                    <li key={a.slug} className="py-2">
                      <Link href={`/help/${a.slug}`} className="block hover:text-primary">
                        <div className="font-medium">{a.title}</div>
                        <div className="text-xs text-slate-500">{a.summary}</div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mt-10 border bg-amber-50">
          <CardContent className="py-6 text-sm">
            <strong>Still stuck?</strong> Email{" "}
            <a href="mailto:support@equiwings.example" className="text-primary underline">
              support@equiwings.example
            </a>{" "}
            with your centre name, a screenshot if useful, and a short description. We reply
            within 1 business day; urgent issues within 2 hours.
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

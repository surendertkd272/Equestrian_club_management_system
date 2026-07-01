import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getSession } from "@/lib/auth";
import { isRole } from "@/lib/roles";
import { getFeaturesForSession } from "@/lib/features-gate";
import { buildRoleGuide, profileFor, PORTAL_ROLES, type RoleProfile, type GuideGroup } from "@/lib/onboarding/role-guide";
import { NavIcon } from "@/components/shell/nav-icons";
import { Play, ChevronRight } from "lucide-react";

export const metadata = {
  title: "Help · Equiwings",
  description: "How-to guides and FAQs for using Equiwings.",
};

// Reads the signed-in user's cookie to tailor the guide → dynamic render.
export const dynamic = "force-dynamic";

// Public help index. Articles live as static MDX/markdown files at
// /help/<slug>/page.tsx; this is the landing page that organises them
// into 5 topical sections. Build out individual articles over time —
// the index degrades gracefully when articles are missing (404).

const SECTIONS = [
  {
    title: "Getting Started",
    articles: [
      { slug: "first-day-checklist", title: "Your First Day With Equiwings", summary: "Set up centres, batches, and your first 10 riders in under an hour." },
      { slug: "invite-staff", title: "Invite Coaches, Vets, and Grooms", summary: "Role-based access for the 16 staff roles we support." },
      { slug: "rider-onboarding", title: "Onboarding Parents + Riders", summary: "Share your centre's signup link, or import a CSV." },
    ],
  },
  {
    title: "Training & Exams",
    articles: [
      { slug: "schedule-lessons", title: "Scheduling Lessons + Horse Allocation", summary: "Pair riders with horses, mark sessions complete." },
      { slug: "track-skills", title: "Skill Progress + Level Promotions", summary: "Per-rider heatmaps, mastery tracking, promotion criteria." },
      { slug: "running-exams", title: "Running Multi-Judge Exams", summary: "Rubric templates, score cards, certificates on pass." },
    ],
  },
  {
    title: "Accreditations",
    articles: [
      { slug: "accreditations", title: "Track EFI / BHS / FEI Memberships", summary: "Federation credentials per rider with expiry alerts." },
    ],
  },
  {
    title: "Horse Care",
    articles: [
      { slug: "horse-health-schedules", title: "Vaccinations, Deworming, Dental", summary: "One schedule, one due-date sweep, alerts before each lapse." },
      { slug: "feed-plans", title: "Per-Horse Feeding Plans", summary: "Time-slot rations, dietary notes for vet review." },
      { slug: "insurance", title: "Horse Insurance + Expiry Tracking", summary: "Policy fields and the expiry alert sweep." },
    ],
  },
  {
    title: "Money & Billing",
    articles: [
      { slug: "fee-plans", title: "Fee Plans + Automatic Invoicing", summary: "Monthly fees, registration, exam fees." },
      { slug: "razorpay-setup", title: "Razorpay Subscription Setup", summary: "Mandate authorisation flow for tenants on autopay." },
      { slug: "saas-invoices", title: "Your Platform Invoices", summary: "Print/save the SaaS invoices we issue to you." },
      { slug: "data-export", title: "Export Your Data (DPDPA)", summary: "One-click full-org export — JSON bundle." },
    ],
  },
];

export default async function HelpIndex() {
  // Tailor the top of the page to the signed-in user's role. Logged-out
  // visitors just see the general how-to articles below.
  const session = await getSession();
  let guide: { profile: RoleProfile; portalNote?: string; groups: GuideGroup[] } | null = null;
  if (session && isRole(session.role)) {
    const role = session.role;
    const portalNote = PORTAL_ROLES[role];
    const groups = portalNote ? [] : buildRoleGuide(role, await getFeaturesForSession(session));
    guide = { profile: profileFor(role), portalNote, groups };
  }

  return (
    <main className="min-h-screen bg-muted/40">
      <header className="border-b bg-card">
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
          <h1 className="text-4xl font-bold">Help & Guides</h1>
          <p className="mt-3 text-muted-foreground">
            Practical how-to articles for everyday Equiwings tasks. Can't find what you need?
            Email <a href="mailto:support@equiwings.example" className="text-primary underline">support@equiwings.example</a> —
            we read every message.
          </p>
        </div>

        {guide && (
          <div className="mt-10">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Your Guide</h2>
                <p className="mt-1 max-w-prose text-muted-foreground">{guide.profile.tagline}</p>
              </div>
              <span className="rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background">
                {guide.profile.title}
              </span>
            </div>

            {!guide.portalNote && (
              <Link
                href="/dashboard?tour=1"
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-accent-foreground transition hover:opacity-90"
              >
                <Play className="h-4 w-4 fill-current" /> Take the 30-Second Guided Tour
              </Link>
            )}

            {guide.portalNote ? (
              <Card className="mt-5 border bg-card">
                <CardContent className="py-5 text-sm text-muted-foreground">{guide.portalNote}</CardContent>
              </Card>
            ) : (
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                {guide.groups.map((g) => (
                  <Card key={g.group} className="border bg-card shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {g.group}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1">
                        {g.items.map((it) => (
                          <li key={it.href}>
                            <Link
                              href={it.href}
                              className="group flex items-start gap-3 rounded-xl p-2.5 transition hover:bg-accent/40"
                            >
                              <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-accent text-accent-foreground">
                                <NavIcon name={it.icon} className="h-[18px] w-[18px]" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-foreground group-hover:text-primary">
                                  {it.label}
                                </span>
                                <span className="block text-xs text-muted-foreground">{it.blurb}</span>
                                {it.help && (
                                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground/80">
                                    {it.help}
                                  </span>
                                )}
                              </span>
                              <ChevronRight className="mt-1.5 h-4 w-4 flex-none text-muted-foreground/40 transition group-hover:text-primary" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            <div className="mt-12 border-t pt-8">
              <h2 className="text-2xl font-bold">General How-To Articles</h2>
              <p className="mt-1 text-muted-foreground">Step-by-step guides for common tasks.</p>
            </div>
          </div>
        )}

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {SECTIONS.map((section) => (
            <Card key={section.title} className="border bg-card">
              <CardHeader>
                <CardTitle className="text-base">{section.title}</CardTitle>
                <CardDescription className="text-muted-foreground">
                  {section.articles.length} articles
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {section.articles.map((a) => (
                    <li key={a.slug} className="py-2">
                      <Link href={`/help/${a.slug}`} className="block hover:text-primary">
                        <div className="font-medium">{a.title}</div>
                        <div className="text-xs text-muted-foreground">{a.summary}</div>
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

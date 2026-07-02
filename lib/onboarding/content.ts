// Onboarding / in-app help content registry — the SINGLE SOURCE OF TRUTH for
// every guided surface. One entry per navigable feature, keyed by the sidebar
// `href`. Today it powers the role-aware Help Center (app/help) and the
// registry-driven empty states (components/onboarding/empty-state.tsx); the
// same data is designed to feed a guided tour + activation checklist later
// without re-authoring content.
//
// INVARIANT: every item in components/shell/sidebar-nav.ts NAV must have an
// entry here. tests/onboarding-coverage.test.ts fails the build otherwise, so
// a new feature can't ship without its one-line help blurb — the same
// discipline as "every table needs an RLS policy".

import { NAV } from "@/components/shell/sidebar-nav";

export type FeatureGuide = {
  /** Short feature name, e.g. "Batches". */
  title: string;
  /** One line: what it's for. Shown in the Help Center. */
  blurb: string;
  /** Optional 1–2 sentence how-to. Shown under the blurb in the Help Center. */
  help?: string;
  /** Optional first-run empty-state copy (registry-driven empty states). */
  emptyState?: { title: string; body: string; cta?: { label: string; href: string } };
};

export const FEATURE_GUIDES: Record<string, FeatureGuide> = {
  // ── Overview
  "/dashboard": { title: "Dashboard", blurb: "Your home screen — a snapshot of the day for your centre.", help: "Land here on login for today's classes, tasks, and alerts at a glance." },
  "/analytics": { title: "Analytics", blurb: "Performance and revenue trend charts.", help: "Track how riders, attendance, and income are trending over time." },
  "/centres": { title: "Clubs (HQ)", blurb: "List and manage every club in your organisation.", help: "HQ oversight of all centres — open one to see its details." },
  "/users": { title: "Users (HQ)", blurb: "Manage all login accounts across the organisation.", help: "Create accounts, set roles, and reset access for any user." },
  "/hq-dashboard": { title: "HQ Comparative", blurb: "Side-by-side numbers for every centre.", help: "Compare clubs on the same metrics to spot outliers." },
  "/hq-expenses": { title: "HQ Invoices", blurb: "Organisation-level billing across clubs.", help: "Review and record invoices rolled up across all centres." },
  "/settings": { title: "Settings", blurb: "Your organisation's public contact details.", help: "Set the support email and phone shown to riders, parents, and staff on the Help Center and portals." },

  // ── Riders & Training
  "/riders": { title: "Riders", blurb: "The rider roster — profiles, levels, contacts, and history.", help: "Search and open a rider to see their level, batch, parent links, and progress." },
  "/enrolments": { title: "Enrolment Approvals", blurb: "Approve or reject public sign-ups.", help: "Vet riders who signed up via your public link before they become registrations." },
  "/batches": { title: "Batches", blurb: "Recurring class slots (day, time, level, coach).", help: "Create a class with the new batch form, then assign riders and mark attendance against it." },
  "/lessons": { title: "Lessons", blurb: "Individual class sessions on a date.", help: "Schedule, reschedule, cancel or complete a session, and assign which horse each rider takes." },
  "/attendance": { title: "Attendance", blurb: "Mark riders present, absent, or late per class.", help: "Pick a batch and date, tap each rider's status, and save." },
  "/progress": { title: "Progress", blurb: "Per-rider skill tracking across disciplines.", help: "Log and review how each rider is progressing on the skill catalog." },
  "/catalog": { title: "Club Catalog", blurb: "Your club's fee plans, levels, and skills.", help: "Configure the fee plans, progression levels, and skills your club uses." },
  "/monthly-skills": { title: "Monthly Skills", blurb: "This month's skill ratings per rider.", help: "Rate each rider's skills — not-yet, needs-work, confident, or mastered — for the month." },
  "/exams": { title: "Exams", blurb: "Formal examinations — sittings, scoring, and results.", help: "Score each rider against the rubric and record the result. Setting up exam sittings is done by managers and admins." },

  // ── Staff & Operations
  "/staff": { title: "Staff", blurb: "The staff directory.", help: "Create staff accounts with a role, KYC, and salary band; edit existing staff." },
  "/staff/onboarding": { title: "Employee Onboarding", blurb: "Self-registration links for new hires.", help: "Send a new joiner a link to submit their details, then approve to create their account." },
  "/staff-attendance": { title: "Staff Attendance", blurb: "Daily staff check-in.", help: "Record who's on duty each day." },
  "/gate": { title: "Gate Log", blurb: "In/out gate entries kiosk.", help: "Log people and visitors in and out, MyGate-style." },
  "/training": { title: "Training & Certs", blurb: "Staff courses and external certifications.", help: "Enrol staff in courses and record certifications like BHS/EFI.", emptyState: { title: "No Certifications Yet", body: "Record a staff member's course completion or an external certification (BHS, EFI, and the like) to start building their training file." } },
  "/leave-requests": { title: "Leave Requests", blurb: "Request time off; managers approve.", help: "Submit your own leave, or approve your team's, with dates and a reason." },
  "/tasks": { title: "Tasks", blurb: "A to-do board for daily centre jobs.", help: "Assign and complete day-to-day tasks across the team." },
  "/checklists": { title: "Daily Checklist", blurb: "The daily operational checklist.", help: "Work through and tick off today's standard checks." },
  "/checklists/templates": { title: "Checklist Templates", blurb: "Define the daily checklist items.", help: "Edit the list of checks staff complete each day." },
  "/daily-update": { title: "Daily Coach Update", blurb: "A quick end-of-day note from each coach.", help: "Summarise your day, riders/horses worked, and flag any concerns — one entry per day." },
  "/daily-update/team": { title: "Team Daily Updates", blurb: "A manager rollup of the team's daily updates.", help: "Read everyone's end-of-day updates in one place." },
  "/approvals": { title: "Approvals", blurb: "Approve or decline requests.", help: "Clear pending purchases and special requests from one queue." },
  "/batch-shifts": { title: "Batch Shifts", blurb: "Review riders' requests to change class.", help: "Approve or decline single-day or permanent batch changes riders ask for." },
  "/requisitions": { title: "Requisitions", blurb: "Request to purchase supplies.", help: "Raise a purchase request; managers and the accountant approve it." },
  "/links": { title: "WhatsApp Links", blurb: "Generate WhatsApp message links.", help: "Create a ready-to-send WhatsApp link to a rider or parent." },
  "/vendors": { title: "Vendors", blurb: "Your supplier contact database.", help: "Keep supplier contacts in one place for procurement." },
  "/advances": { title: "Salary Advances", blurb: "Record and track advances paid to staff.", help: "Log an advance; it's auto-deducted from the next payroll run." },
  "/salary": { title: "Salary & Payroll", blurb: "Run monthly payroll.", help: "Record monthly salaries; outstanding advances are deducted automatically." },
  "/facility-bookings": { title: "Facility Bookings", blurb: "Book arenas, wash bays, and classrooms.", help: "Reserve a facility for a time slot; the system flags clashes." },

  // ── Stable & Veterinary
  "/equipment": { title: "Tack & Equipment", blurb: "Inventory of saddles, gear, and school equipment.", help: "Track stock levels and reorder points for tack and equipment." },
  "/medicines": { title: "Vet Medicines", blurb: "Medicine inventory and stock.", help: "Record medicines, stock, and usage; watch expiry dates." },
  "/vet-followups": { title: "Vet Follow-Ups", blurb: "Calendar of upcoming vet follow-ups.", help: "See which horses need a follow-up and when." },
  "/consumables": { title: "First-Aid Consumables", blurb: "Stock of bandages, antiseptics, and the like.", help: "Keep first-aid consumable levels topped up." },
  "/horses": { title: "Horses", blurb: "The horse roster — profiles, medical, and allocations.", help: "Open a horse for its profile, medical history, and stable details." },
  "/vaccinations": { title: "Vaccinations", blurb: "Horse vaccination records and due dates.", help: "Log vaccinations and track what's due." },
  "/farriery": { title: "Farriery", blurb: "Schedule and log farrier (shoeing) visits.", help: "Record shoeing visits per horse and plan the next one." },
  "/injuries": { title: "Injury log", blurb: "Horse and rider injury records.", help: "Log an injury and track recovery to resolution." },

  // ── Events & Teams
  "/events": { title: "Events", blurb: "Clinics, shows, schooling days, and fundraisers.", help: "Create an event, then manage registrations against it." },
  "/teams": { title: "Teams / squads", blurb: "Group riders into named teams.", help: "Build squads for events and training." },
  "/transport": { title: "Event transport", blurb: "Horse and equipment transport manifest.", help: "Build a manifest and check horses/gear out and back in for an event." },

  // ── Money & Records
  "/expenses/submit": { title: "Submit invoice", blurb: "Drop in bills you paid for the club.", help: "Upload a receipt and amount for something you bought on the club's behalf, for reimbursement." },
  "/reports": { title: "Reports", blurb: "Monthly parent report cards and exports.", help: "Generate report cards and analytical exports." },
  "/reports/procurement": { title: "Procurement report", blurb: "Club-wise spend snapshot.", help: "See farrier, fodder, hay, and medicine spend at a glance." },
  "/certificates": { title: "Certificates", blurb: "Issue QR-verified certificates.", help: "Issue a certificate for a promotion or event; each carries a QR code anyone can verify.", emptyState: { title: "No certificates issued yet", body: "Certificates are awarded for level promotions and events. Once a rider passes an exam, issue one here — each gets a QR code that anyone can verify online." } },
  "/accreditations": { title: "Accreditations", blurb: "Track riders' federation memberships (EFI/BHS/FEI).", help: "Record external federation credentials and watch their expiry." },
  "/notifications": { title: "Notifications", blurb: "Your alerts inbox.", help: "Catch up on alerts and updates addressed to you." },
  "/audit": { title: "Audit log", blurb: "The full system activity log.", help: "Review who did what across the system." },
  "/inspections": { title: "Inspections", blurb: "Run SOP, inventory, and stable audits.", help: "Start an inspection, mark each checklist line pass/fail with remarks, then complete it." },
  "/bin": { title: "Recycle bin", blurb: "Recover deleted catalog rows.", help: "Restore items deleted in the last 30 days before they're purged." },
};

/** Every sidebar href, flattened — used by the assembler and the coverage test. */
export function allNavHrefs(): string[] {
  return NAV.flatMap((g) => g.items.map((i) => i.href));
}

export function guideFor(href: string): FeatureGuide | undefined {
  return FEATURE_GUIDES[href];
}

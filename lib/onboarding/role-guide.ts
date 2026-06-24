// Assembles a role's in-app guide from the SAME data that builds their
// sidebar — so a new role (or a new menu item) is covered automatically,
// with no per-role content to maintain.

import type { Role } from "@/lib/roles";
import type { FeatureKey } from "@/lib/features";
import { filterSidebarNav } from "@/components/shell/sidebar-nav";
import { FEATURE_GUIDES } from "@/lib/onboarding/content";

export type RoleProfile = {
  /** Friendly role name, e.g. "Coach". */
  title: string;
  /** One line on who this role is — sets the tone of the guide. */
  tagline: string;
};

export type GuideItem = { href: string; label: string; blurb: string; help?: string };
export type GuideGroup = { group: string; items: GuideItem[] };

// Per-role intro shown at the top of the Help Center. Record<Role,...> forces
// every role to be covered — adding a role to lib/roles.ts won't compile until
// it has a profile here.
export const ROLE_PROFILES: Record<Role, RoleProfile> = {
  SUPER_ADMIN: { title: "Super Admin", tagline: "Full control of the whole organisation — clubs, users, and every module." },
  ADMIN: { title: "Admin", tagline: "HQ-level oversight, staff, catalog, and finance across all clubs." },
  CENTRE_MANAGER: { title: "Centre Manager", tagline: "You run your club end-to-end — riders, staff, horses, and money." },
  HEAD_COACH: { title: "Head Coach", tagline: "Lead the coaching team: classes, exams, teams, and daily updates." },
  COACH: { title: "Coach", tagline: "Run your daily classes — lessons, attendance, progress, and updates." },
  STABLE_MANAGER: { title: "Stable Manager", tagline: "Run the stable and grounds — horses, tack, farrier, and vet schedules." },
  INVENTORY_MANAGER: { title: "Inventory Manager", tagline: "Keep tack, equipment, and medicine stock accurate and topped up." },
  GROOM: { title: "Groom", tagline: "Hands-on horse care and your daily jobs." },
  FARRIER: { title: "Farrier", tagline: "Log shoeing visits and flag anything you spot on the horses." },
  VET: { title: "Vet", tagline: "Horse health — medicines, vaccinations, follow-ups, and injuries." },
  ACCOUNTANT: { title: "Accountant", tagline: "The money — invoices, payroll, advances, and procurement." },
  EXAMINER: { title: "Examiner", tagline: "Score exams and issue certificates on exam day." },
  SCHOOL_ADMINISTRATOR: { title: "School Administrator", tagline: "A read-only window into your school's riders, plus enrolment approvals." },
  INSPECTION_OFFICER: { title: "Inspection Officer", tagline: "Run inventory, vet-cabinet, and stable inspections on site." },
  RIDER: { title: "Rider", tagline: "Your riding journey — progress, classes, exams, and certificates." },
  PARENT: { title: "Parent", tagline: "Track your children's attendance, progress, and fees." },
};

// Roles that have their own portal rather than the staff workspace. The Help
// Center shows them a short note instead of a (non-existent) staff menu.
export const PORTAL_ROLES: Partial<Record<Role, string>> = {
  RIDER: "Everything you need is on your home page when you log in — your progress, class, attendance, exams, and certificates. There's no menu to learn.",
  PARENT: "Your home page lists each of your children. Open a child to see their attendance, exams, certificates, and any fees due.",
  SCHOOL_ADMINISTRATOR: "You land on a read-only dashboard of your club's riders — attendance, levels, recent exams, and skill updates — plus any sign-ups waiting for your approval.",
};

export function profileFor(role: Role): RoleProfile {
  return ROLE_PROFILES[role] ?? { title: role, tagline: "" };
}

/**
 * The role's guide, grouped exactly like their sidebar (minus the duplicate
 * "Pinned for you" shortcut group). Each item carries its registry blurb +
 * how-to. Feature-gated items the club hasn't enabled are already filtered out
 * by filterSidebarNav, so the guide never mentions something the user can't see.
 */
export function buildRoleGuide(role: Role, features: ReadonlySet<FeatureKey>): GuideGroup[] {
  return filterSidebarNav(role, features)
    .filter((g) => g.group !== "Pinned for you")
    .map((g) => ({
      group: g.group,
      items: g.items.map((it) => {
        const guide = FEATURE_GUIDES[it.href];
        return { href: it.href, label: it.label, blurb: guide?.blurb ?? "", help: guide?.help };
      }),
    }))
    .filter((g) => g.items.length > 0);
}

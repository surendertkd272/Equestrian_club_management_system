"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/roles";
import type { FeatureKey } from "@/lib/features";
import { filterSidebarNav } from "./sidebar-nav";
import { Menu, X } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  TrendingUp,
  LineChart,
  ClipboardList,
  Trophy,
  Users2,
  ListChecks,
  Package,
  Pill,
  Rabbit,
  CalendarRange,
  Receipt,
  FileText,
  Award,
  Bell,
  Shield,
  UserCheck,
  CalendarX,
  Building2,
  UserCog,
  Syringe,
  Hammer,
  Bandage,
  GraduationCap,
  FileCheck,
  Building,
  Flag,
} from "lucide-react";

// Icon registry — referenced by name from sidebar-nav.ts so that file stays
// JSX-free and importable from tests/RSC contexts.
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  Users,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  TrendingUp,
  LineChart,
  ClipboardList,
  Trophy,
  Users2,
  ListChecks,
  Package,
  Pill,
  Rabbit,
  CalendarRange,
  Receipt,
  FileText,
  Award,
  Bell,
  Shield,
  UserCheck,
  CalendarX,
  Building2,
  UserCog,
  Syringe,
  Hammer,
  GraduationCap,
  FileCheck,
  Building,
  Flag,
  // lucide-react exports the icon as `Bandage`; sidebar-nav.ts references it
  // as `BandageIcon` for clarity in nav definitions.
  BandageIcon: Bandage,
};

export function Sidebar({
  role,
  features,
}: {
  role: Role;
  features: readonly FeatureKey[];
}) {
  const pathname = usePathname();
  const groups = filterSidebarNav(role, new Set(features));
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auto-close the drawer on route change so navigating doesn't leave a
  // half-open sheet over the new page.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Esc closes the drawer.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {/* Mobile-only hamburger trigger. The desktop topbar already has
          plenty of buttons; this floats so the user can find it without
          scrolling. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        className="fixed bottom-4 right-4 z-30 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Backdrop — tap to close. md+ devices never render either. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          "border-r bg-card",
          // Mobile: fixed slide-in drawer. Desktop: in-flow static column.
          "fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto transition-transform duration-200 md:static md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="flex h-16 items-center justify-between gap-2 border-b px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
              E
            </div>
            <div>
              <div className="text-sm font-bold leading-none">Equiwings</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Central Admin</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="rounded p-1 hover:bg-muted md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="p-3 text-sm">
        {groups.map((group) => (
          <div key={group.group} className="mb-4">
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.group}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((it) => {
                const active = pathname === it.href || pathname.startsWith(it.href + "/");
                const Icon = ICONS[it.iconName];
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                        active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
                      )}
                    >
                      {Icon && <Icon className="h-4 w-4" />}
                      {it.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        </nav>
      </aside>
    </>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The portal had no navigation at all — one page and a logout button. Every
// feature added to it after that would have been unreachable, which is a
// failure mode this project has hit twice: work that exists and cannot be
// found is work nobody has.

const TABS = [
  { href: "/school", label: "Overview" },
  { href: "/school/riders", label: "Riders" },
  { href: "/school/horses", label: "Horse workload" },
  { href: "/school/exams", label: "Exams & leaderboard" },
  { href: "/school/tasks", label: "Tasks" },
];

export function SchoolNav() {
  const pathname = usePathname();
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto">
      {TABS.map((t) => {
        // Exact match for the overview, prefix for the rest, so /school/riders
        // does not light up Overview as well.
        const active = t.href === "/school" ? pathname === "/school" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors " +
              (active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

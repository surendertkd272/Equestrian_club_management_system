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
  { href: "/school/horses", label: "Horse Workload" },
  { href: "/school/exams", label: "Exams & Leaderboard" },
  { href: "/school/tasks", label: "Tasks" },
];

export function SchoolNav({ openTasks = 0 }: { openTasks?: number }) {
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
            {t.href === "/school/tasks" && openTasks > 0 && (
              <span
                className="ml-1.5 inline-flex min-w-[1.25rem] justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground"
                aria-label={`${openTasks} open ${openTasks === 1 ? "task" : "tasks"} for you`}
              >
                {openTasks}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, Phone, HelpCircle } from "lucide-react";
import type { SessionPayload } from "@/lib/auth";
import { CommandPalette } from "./cmdk";
import { NotificationsDropdown } from "./notifications-dropdown";
import { ThemeToggle } from "./theme-toggle";
import { HqCentreSwitcher } from "./hq-centre-switcher";
import { signOutAndRedirect } from "@/lib/client-logout";

export type EmergencyContact = { label: string; number: string; type: string };

const TYPE_TONE: Record<string, string> = {
  vet: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
  ambulance: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30",
  police: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30",
  fire: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  manager: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30",
  other: "bg-muted text-muted-foreground border",
};

export function TopBar({
  session,
  centre,
  allCentres,
  unreadCount,
  emergencyContacts,
  photoUrl,
  hqCentreFilter,
}: {
  session: SessionPayload;
  centre: { id: string; name: string; slug: string } | null;
  allCentres: { id: string; name: string; slug: string }[];
  unreadCount: number;
  emergencyContacts?: EmergencyContact[];
  photoUrl?: string | null;
  // Active centre filter for HQ-tier admins. null = "all centres".
  // Only used when session.role is SUPER_ADMIN or ADMIN.
  hqCentreFilter?: string | null;
}) {
  const router = useRouter();
  const logout = () => signOutAndRedirect(router);

  const contacts = emergencyContacts ?? [];

  return (
    <div className="border-b bg-card">
      <header className="flex h-16 items-center justify-between gap-2 px-3 md:px-6">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <div className="min-w-0 text-sm">
            <div className="truncate font-semibold">
              {session.role === "SUPER_ADMIN" || session.role === "ADMIN"
                ? hqCentreFilter
                  ? (allCentres.find((c) => c.id === hqCentreFilter)?.name ?? "Centre")
                  : "All centres"
                : centre?.name ?? "—"}
            </div>
            <div className="truncate text-xs text-muted-foreground">{session.role.replaceAll("_", " ")}</div>
          </div>
          {(session.role === "SUPER_ADMIN" || session.role === "ADMIN") && allCentres.length > 0 && (
            <HqCentreSwitcher centres={allCentres} selected={hqCentreFilter ?? null} />
          )}
        </div>
        <div className="flex items-center gap-1 md:gap-3">
          <CommandPalette />
          <ThemeToggle />
          <NotificationsDropdown initialUnread={unreadCount} />
          <Link
            href="/help"
            className="grid h-9 w-9 place-items-center rounded-md hover:bg-accent/10"
            title="Help & guide"
            aria-label="Help & guide"
          >
            <HelpCircle className="h-5 w-5" />
          </Link>
          <Link href="/account" className="flex items-center gap-2 text-right text-sm hover:underline" title="Account settings">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="" className="h-8 w-8 rounded-full border object-cover" />
            ) : (
              <span className="grid h-8 w-8 place-items-center rounded-full border bg-muted text-xs font-semibold uppercase">
                {session.name.split(" ").slice(0, 2).map((p) => p[0]).join("")}
              </span>
            )}
            <div className="hidden font-medium md:block">{session.name}</div>
          </Link>
          <Button variant="outline" size="sm" onClick={logout} aria-label="Sign out">
            <LogOut className="h-4 w-4" />
            <span className="hidden md:inline">Sign out</span>
          </Button>
        </div>
      </header>

      {contacts.length > 0 && (
        // PDF §3 "Emergency Contact Board" — keep these tappable for staff
        // who are on the field with a phone, not in front of a desk.
        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-3 py-1.5 text-xs md:px-6">
          <span className="font-semibold uppercase tracking-wide text-muted-foreground">
            <Phone className="mr-1 inline h-3 w-3" />
            Emergency:
          </span>
          {contacts.slice(0, 8).map((c, i) => (
            <a
              key={i}
              href={`tel:${c.number.replace(/[^\d+]/g, "")}`}
              className={`rounded border px-2 py-0.5 hover:brightness-95 ${TYPE_TONE[c.type] ?? TYPE_TONE.other}`}
            >
              <span className="font-medium">{c.label}</span>
              <span className="ml-1 font-mono">{c.number}</span>
            </a>
          ))}
          {contacts.length > 8 && (
            <Link href="/centres" className="text-muted-foreground hover:underline">
              + {contacts.length - 8} more
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

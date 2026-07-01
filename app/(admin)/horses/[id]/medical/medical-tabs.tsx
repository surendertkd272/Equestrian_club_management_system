"use client";

import { useState } from "react";

const TABS = [
  { id: "vaccination", label: "Vaccination" },
  { id: "deworming", label: "Deworming" },
  { id: "temperature", label: "Temperature Trend" },
  { id: "injury", label: "Injuries" },
  { id: "farrier", label: "Farrier" },
  { id: "insurance", label: "Insurance" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function MedicalTabs({
  initial,
  tabs,
}: {
  initial: TabId;
  tabs: Record<TabId, React.ReactNode>;
}) {
  const [active, setActive] = useState<TabId>(initial);
  return (
    <div>
      <div className="border-b">
        <div className="flex flex-wrap gap-1 -mb-px">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className={`px-3 py-2 text-sm font-medium transition border-b-2 ${
                active === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="pt-4">{tabs[active]}</div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Plus, Minus } from "lucide-react";
import type { RubricCategory } from "@/lib/schemas/exam";
import { cn } from "@/lib/utils";

type ScoreMap = Record<string, number | string>;

export function ScoringEngine({
  rubricConfig,
  initialScores = {},
  readOnly = false,
  onScoreChange,
}: {
  rubricConfig: RubricCategory[];
  initialScores?: ScoreMap;
  readOnly?: boolean;
  onScoreChange: (scores: ScoreMap, total: number) => void;
}) {
  // Hydrate once. Do NOT re-sync from initialScores on every parent render —
  // server polls would wipe out in-progress edits.
  const [scores, setScores] = useState<ScoreMap>(() => initialScores);

  useEffect(() => {
    const total = numericSum(scores, rubricConfig);
    onScoreChange(scores, total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores]);

  const update = (key: string, v: number | string) => {
    if (readOnly) return;
    setScores((prev) => ({ ...prev, [key]: v }));
  };

  const scoringCats = rubricConfig.filter(
    (c) => (!c.type || c.type === "numeric") && c.name !== "Miscellaneous Questions",
  );
  const maxPossible = scoringCats.reduce(
    (sum, c) => sum + c.items.filter((i) => !i.type || i.type === "numeric").reduce((s, i) => s + i.max_score, 0),
    0,
  );
  const currentTotal = numericSum(scores, rubricConfig);

  const totalItems = scoringCats.reduce((s, c) => s + c.items.filter((i) => !i.type || i.type === "numeric").length, 0);
  const filledItems = scoringCats.reduce(
    (s, c) =>
      s +
      c.items
        .filter((i) => !i.type || i.type === "numeric")
        .filter((i) => scores[`${c.name}_${i.name}`] !== undefined).length,
    0,
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-lg border bg-card p-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Progress</div>
          <div className="mt-0.5 text-sm">
            {filledItems} of {totalItems} items scored
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-extrabold text-primary">
            {currentTotal}
            <span className="text-sm font-normal text-muted-foreground">/{maxPossible}</span>
          </div>
        </div>
      </div>

      {rubricConfig.map((section) => {
        const sType = section.type ?? "numeric";
        if (sType === "text") return <TextSection key={section.name} section={section} scores={scores} update={update} />;
        if (sType === "select") return <SelectSection key={section.name} section={section} scores={scores} update={update} />;
        return <NumericSection key={section.name} section={section} scores={scores} update={update} readOnly={readOnly} />;
      })}
    </div>
  );
}

function numericSum(scores: ScoreMap, rubric: RubricCategory[]): number {
  let total = 0;
  for (const cat of rubric) {
    if (cat.type && cat.type !== "numeric") continue;
    if (cat.name === "Miscellaneous Questions") continue;
    for (const item of cat.items) {
      if (item.type && item.type !== "numeric") continue;
      const v = scores[`${cat.name}_${item.name}`];
      if (typeof v === "number") total += v;
    }
  }
  return total;
}

function TextSection({
  section,
  scores,
  update,
}: {
  section: RubricCategory;
  scores: ScoreMap;
  update: (k: string, v: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-l-4 border-l-violet-500 bg-card">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <div>
          <h3 className="text-base font-bold">{section.name}</h3>
          <span className="text-[11px] text-muted-foreground">Free text — does not affect score total</span>
        </div>
        <span className="rounded-md bg-violet-50 px-3 py-1 text-xs font-bold text-violet-600">Text</span>
      </div>
      <div className="space-y-3 p-5">
        {section.items.map((item) => {
          const key = `${section.name}_${item.name}`;
          return (
            <div key={item.name} className="space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">{item.name}</span>
              <textarea
                value={(scores[key] as string) || ""}
                onChange={(e) => update(key, e.target.value)}
                placeholder={`Enter ${item.name.toLowerCase()}…`}
                rows={3}
                className="w-full rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SelectSection({
  section,
  scores,
  update,
}: {
  section: RubricCategory;
  scores: ScoreMap;
  update: (k: string, v: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-l-4 border-l-amber-500 bg-card">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <div>
          <h3 className="text-base font-bold">{section.name}</h3>
          <span className="text-[11px] text-muted-foreground">Select one — does not affect score total</span>
        </div>
        <span className="rounded-md bg-amber-50 px-3 py-1 text-xs font-bold text-amber-600">Select</span>
      </div>
      <div className="space-y-3 p-5">
        {section.items.map((item) => {
          const key = `${section.name}_${item.name}`;
          const current = (scores[key] as string) || "";
          return (
            <div key={item.name} className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground">{item.name}</span>
              <div className="flex flex-wrap gap-2">
                {(section.options ?? []).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => update(key, opt)}
                    className={cn(
                      "rounded-md border-2 px-4 py-2 text-sm font-semibold transition-colors",
                      current === opt
                        ? "border-amber-500 bg-amber-50 text-amber-800"
                        : "border-input bg-background hover:bg-muted",
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NumericSection({
  section,
  scores,
  update,
  readOnly,
}: {
  section: RubricCategory;
  scores: ScoreMap;
  update: (k: string, v: number | string) => void;
  readOnly: boolean;
}) {
  const sectionMax = section.items
    .filter((i) => !i.type || i.type === "numeric")
    .reduce((s, i) => s + i.max_score, 0);
  const sectionScore = section.items
    .filter((i) => !i.type || i.type === "numeric")
    .reduce((s, i) => {
      const v = scores[`${section.name}_${i.name}`];
      return s + (typeof v === "number" ? v : 0);
    }, 0);
  const isMisc = section.name === "Miscellaneous Questions";

  return (
    <div className={cn("overflow-hidden rounded-lg border border-l-4 bg-card", isMisc ? "border-l-slate-400" : "border-l-primary")}>
      <div className="flex items-center justify-between border-b px-5 py-3">
        <div>
          <h3 className="text-base font-bold">{section.name}</h3>
          <span className="text-[11px] text-muted-foreground">
            {section.items.length} item{section.items.length === 1 ? "" : "s"}
            {isMisc && " · excluded from total"}
          </span>
        </div>
        {!isMisc && (
          <span className="rounded-md bg-primary/10 px-3 py-1 text-xs font-extrabold text-primary">
            {sectionScore}/{sectionMax}
          </span>
        )}
      </div>
      <div className="space-y-5 p-5">
        {section.items.map((item) => {
          const itemType = item.type ?? "numeric";
          const key = `${section.name}_${item.name}`;
          const raw = scores[key];

          if (itemType === "text") {
            return (
              <div key={item.name} className="space-y-2">
                <span className="text-sm font-semibold">{item.name}</span>
                <input
                  type="text"
                  value={(raw as string) || ""}
                  onChange={(e) => update(key, e.target.value)}
                  placeholder="Type here…"
                  disabled={readOnly}
                  className="w-full rounded-md border border-input bg-background p-3 text-sm"
                />
              </div>
            );
          }

          if (itemType === "number") {
            return (
              <div key={item.name} className="space-y-2">
                <span className="text-sm font-semibold">{item.name}</span>
                <input
                  type="number"
                  value={raw ?? ""}
                  onChange={(e) => update(key, e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="0"
                  disabled={readOnly}
                  className="w-full rounded-md border border-input bg-background p-3 text-sm"
                />
              </div>
            );
          }

          if (itemType === "select") {
            const current = (raw as string) || "";
            return (
              <div key={item.name} className="space-y-2">
                <span className="text-sm font-semibold">{item.name}</span>
                <div className="flex flex-wrap gap-2">
                  {(item.options ?? []).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => update(key, opt)}
                      className={cn(
                        "min-w-20 rounded-md border-2 px-4 py-2 text-sm font-semibold transition-colors",
                        current === opt ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:bg-muted",
                      )}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            );
          }

          // numeric (default)
          const max = item.max_score;
          const val = typeof raw === "number" ? raw : 0;
          const step = max % 1 !== 0 ? 0.5 : 1;
          const buttonValues = Array.from({ length: Math.round(max / step) + 1 }, (_, i) =>
            parseFloat((i * step).toFixed(1)),
          );
          const useButtons = max <= 5;

          return (
            <div key={item.name} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{item.name}</span>
                <span className="text-sm font-extrabold text-primary">
                  {val}/{max}
                </span>
              </div>
              {useButtons ? (
                <div className="flex flex-wrap gap-1.5">
                  {buttonValues.map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => update(key, b)}
                      disabled={readOnly}
                      className={cn(
                        "h-11 min-w-11 rounded-md border-2 font-bold transition-colors",
                        val === b ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:bg-muted",
                      )}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => update(key, parseFloat(Math.max(0, val - 1).toFixed(1)))}
                    disabled={readOnly}
                    className="grid h-12 w-12 place-items-center rounded-md border-2 border-input bg-muted hover:bg-muted/80"
                    aria-label="decrease"
                  >
                    <Minus className="h-5 w-5" />
                  </button>
                  <div className="flex-1 border-b-2 pb-1 text-center text-2xl font-extrabold text-primary">{val}</div>
                  <button
                    type="button"
                    onClick={() => update(key, parseFloat(Math.min(max, val + 1).toFixed(1)))}
                    disabled={readOnly}
                    className="grid h-12 w-12 place-items-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                    aria-label="increase"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

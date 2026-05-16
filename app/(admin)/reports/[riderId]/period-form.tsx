"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function PeriodForm({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const sp = new URLSearchParams({ from: f, to: t });
    router.push(`?${sp.toString()}`);
  }

  return (
    <form onSubmit={apply} className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1">
      <Input type="date" value={f} onChange={(e) => setF(e.target.value)} className="h-7 w-32 text-xs" />
      <span className="text-xs text-muted-foreground">→</span>
      <Input type="date" value={t} onChange={(e) => setT(e.target.value)} className="h-7 w-32 text-xs" />
      <Button type="submit" size="sm" variant="outline" className="h-7 px-2 text-xs">
        Apply
      </Button>
    </form>
  );
}

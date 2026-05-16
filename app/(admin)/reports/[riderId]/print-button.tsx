"use client";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <Button onClick={() => window.print()} size="sm">
      <Printer className="h-4 w-4" /> Print / Save as PDF
    </Button>
  );
}

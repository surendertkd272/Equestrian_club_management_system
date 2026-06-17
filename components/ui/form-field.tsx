"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Accessible field wrapper: ties a visible <Label> to its control via a
// generated id, and wires inline error + hint text through aria-describedby /
// aria-invalid / role="alert". The control is supplied via render-prop and
// MUST spread the props it receives so the id + aria attributes land on it:
//
//   <FormField label="Email" error={errors.email} required>
//     {(p) => <Input type="email" {...p} value={v} onChange={…} />}
//   </FormField>
//
// (Input/Select/Textarea already get a red border on aria-invalid via their
// own classes, so an invalid field is visible as well as announced.)

type FieldRenderProps = {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
};

export function FormField({
  label,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  className?: string;
  children: (props: FieldRenderProps) => React.ReactNode;
}) {
  const id = React.useId();
  const errorId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

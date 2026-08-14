import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
        success: "border-transparent bg-success-soft text-success-foreground",
        warning: "border-transparent bg-warning-soft text-warning-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

// Status glyphs. Colour alone carries the meaning of every status badge in the
// app — roughly 1 in 12 men has some red/green deficiency, and these are read
// on a phone in daylight in a barn (the washed-out screenshot that started the
// inventory work is a fair sample of the viewing conditions).
//
// A shape survives all of that: ● ok, ▲ needs attention, ■ problem. Rendered
// aria-hidden because the badge's own text already says it.
const GLYPH: Partial<Record<NonNullable<BadgeProps["variant"]>, string>> = {
  success: "●",
  warning: "▲",
  destructive: "■",
};

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Opt out where the glyph would be noise (e.g. a count chip). */
  noGlyph?: boolean;
}

export function Badge({ className, variant, noGlyph, children, ...props }: BadgeProps) {
  const glyph = !noGlyph && variant ? GLYPH[variant] : undefined;
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {glyph && (
        <span aria-hidden className="text-[0.7em] leading-none">
          {glyph}
        </span>
      )}
      {children}
    </div>
  );
}

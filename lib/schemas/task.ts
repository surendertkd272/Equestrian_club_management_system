import { z } from "zod";

export const TASK_STATUSES = ["open", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// Free-text label (we don't run a cron expander yet); used purely for display.
export const TASK_RECURRENCES = ["once", "daily", "weekly", "monthly"] as const;

// Task kinds let the UI filter "dress rehearsals", "stable cleaning", etc.
// PDF Phase-1 calls out dress rehearsals specifically; we don't model them as
// a separate table.
export const TASK_KINDS = [
  "generic",
  "dress_rehearsal",
  "stable",
  "feeding",
  "rehearsal",
  "vet_followup",
  "farrier_followup",
] as const;

export const createTaskSchema = z.object({
  // Title min loosened to 1 — single-word task templates like "X" (X-ray
  // reminder) or "Q" (quarantine check) are valid. The form's `required`
  // attribute on the input already blocks empty strings.
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  kind: z.enum(TASK_KINDS).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  dueAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Local datetime YYYY-MM-DDTHH:MM")
    .or(z.string().datetime())
    .optional(),
  recurrence: z.enum(TASK_RECURRENCES).optional().default("once"),
  // SUPER_ADMIN posts this when they don't have a centreId pinned in the
  // session. Centre-scoped users ignore it (server uses session centre).
  centreId: z.string().min(1).optional(),
});

export const updateTaskSchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  title: z.string().min(2).max(120).optional(),
  description: z.string().max(500).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  dueAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Local datetime YYYY-MM-DDTHH:MM")
    .or(z.string().datetime())
    .nullable()
    .optional(),
  // Spec §4.9: completion proof URL (uploaded via /api/upload, kind=generic).
  // The schema's URL whitelist matches our /uploads/<file> shape — see lib/storage.ts.
  proofUrl: z
    .string()
    .regex(/^\/uploads\/[a-z0-9._-]+$/i, "Must be an /uploads/ URL from our upload endpoint")
    .nullable()
    .optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

// Spec §4.9: 2× overdue → escalated. Computed dynamically (no cron yet).
//
// `anchor` is the IMMUTABLE overdue anchor — callers pass `overdueSince ?? dueAt`
// (overdueSince is frozen at the first dueAt and never bumped by later edits),
// so nudging a task's dueAt forward can't cosmetically clear its overdue /
// escalated badge. Legacy rows with null overdueSince fall back to dueAt.
export function deriveOverdue(anchor: Date | null, status: string, now = new Date()): boolean {
  if (status === "done") return false;
  if (!anchor) return false;
  return anchor < now;
}

export function deriveEscalated(anchor: Date | null, status: string, now = new Date()): boolean {
  if (status === "done") return false;
  if (!anchor) return false;
  // >24h past the anchor → escalated.
  return now.getTime() - anchor.getTime() > 24 * 60 * 60 * 1000;
}

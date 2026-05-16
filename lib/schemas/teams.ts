import { z } from "zod";

export const createTeamSchema = z.object({
  name: z.string().min(1).max(120),
  season: z.string().max(40).optional(),
  discipline: z.string().max(40).optional(),
  captainId: z.string().nullable().optional(),
  notes: z.string().max(500).optional(),
});

export const addMemberSchema = z.object({
  riderId: z.string().min(1),
  position: z.string().max(40).optional(),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;

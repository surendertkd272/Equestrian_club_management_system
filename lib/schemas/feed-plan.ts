import { z } from "zod";

// Each Ration is a meal slot ("morning"/"noon"/"evening"/"night" or any
// free-text). Items are the things fed: free-text feed name + qty + unit.
// Kept flexible because feeds vary wildly by region (alfalfa hay, oats,
// gram, mash, jaggery, etc.). Tighten later if a controlled list emerges.
const Item = z.object({
  feed: z.string().min(1).max(80),
  qty: z.number().positive().max(100),
  unit: z.string().min(1).max(12), // "kg" | "g" | "L" | "scoops" | "flakes"
});

const Ration = z.object({
  time: z.string().min(1).max(40),
  items: z.array(Item).min(1).max(10),
});

export const upsertFeedPlanSchema = z.object({
  horseId: z.string().min(1),
  rations: z.array(Ration).min(1).max(8),
  notes: z.string().max(500).optional().nullable(),
});

export type FeedRation = z.infer<typeof Ration>;

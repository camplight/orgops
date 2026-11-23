import { z } from "zod";

const modelId = z.string().regex(/^openrouter:[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
/** Explicit, single-message request. No persisted agent configuration is changed. */
export const TaskModelSchema = z.discriminatedUnion("mode", [
  z.object({ agentName: z.string().min(1), mode: z.literal("manual"), modelId }).strict(),
  z.object({
    agentName: z.string().min(1), mode: z.literal("economy"),
    minIntelligence: z.number().min(0).max(100),
    maxPricePerMillion: z.number().finite().nonnegative(),
    minContextTokens: z.number().int().min(4096).max(2_000_000).default(32_000),
  }).strict(),
]);
export type TaskModel = z.infer<typeof TaskModelSchema>;

/** A bounded task hint, not permission to choose arbitrary models or credentials. */
export const TaskRoutingSchema = z.object({
  tier: z.enum(['routine', 'standard', 'complex', 'default']),
  reason: z.enum(['classified', 'unavailable', 'uncertain']),
  confidence: z.number().finite().min(0).max(1).optional(),
}).strict();
export type TaskRouting = z.infer<typeof TaskRoutingSchema>;

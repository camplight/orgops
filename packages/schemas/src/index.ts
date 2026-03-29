import { z } from "zod";
export * from "./event-shapes";

export const EventStatusSchema = z.enum([
  "PENDING",
  "DELIVERED",
  "ACKED",
  "FAILED",
  "DEAD",
]);

export const EventSchema = z.object({
  id: z.string().optional(),
  type: z.string(),
  payload: z.unknown(),
  source: z.string(),
  channelId: z.string().optional(),
  parentEventId: z.string().optional(),
  deliverAt: z.number().optional(),
  status: EventStatusSchema.optional(),
  idempotencyKey: z.string().optional(),
});

export const AgentSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  icon: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  modelId: z.string(),
  systemInstructions: z.string().optional().default(""),
  soulPath: z.string(),
  workspacePath: z.string(),
  allowOutsideWorkspace: z.boolean().optional().default(false),
  llmCallTimeoutMs: z.number().int().positive().optional().nullable(),
  classicMaxModelSteps: z.number().int().positive().optional().nullable(),
  contextSessionGapMs: z.number().int().positive().optional().nullable(),
  memoryContextMode: z
    .enum(["PER_CHANNEL_CROSS_CHANNEL", "FULL_CHANNEL_EVENTS", "OFF"])
    .optional(),
  desiredState: z.enum(["RUNNING", "STOPPED"]).optional(),
  runtimeState: z
    .enum(["STARTING", "RUNNING", "STOPPED", "CRASHED"])
    .optional(),
});

export const ModelSchema = z.object({
  id: z.string(),
  provider: z.string(),
  modelName: z.string(),
  enabled: z.boolean(),
  defaults: z.record(z.unknown()).default({}),
});

export const AuthLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type EventInput = z.infer<typeof EventSchema>;
export type AgentInput = z.infer<typeof AgentSchema>;
export type ModelInput = z.infer<typeof ModelSchema>;

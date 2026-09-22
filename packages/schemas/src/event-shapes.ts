import { z } from "zod";
import { CatalogConfigurationAuditSchema } from "./catalogs/configuration";
import { CatalogAssignmentAuditEventSchema, CatalogAuditEventSchema } from "./catalogs/source-library";
import { SkillAuditEventSchema } from "./unified-skills";
import { zodToJsonSchema } from "zod-to-json-schema";

export type EventDraft = {
  type: string;
  payload: unknown;
  source: string;
  channelId?: string | null;
  parentEventId?: string;
  deliverAt?: number;
  idempotencyKey?: string;
};

export const IMMUTABLE_EVENT_SCHEMA_JSON = Symbol("orgops.immutableEventSchemaJson");

export type EventShapeDefinition = {
  type: string;
  description: string;
  source?: "core" | `skill:${string}`;
  payloadSchema?: z.ZodTypeAny;
  eventSchema?: z.ZodTypeAny;
  payloadExample?: unknown;
};

export type EventValidationIssue = {
  source: string;
  message: string;
};

export type EventValidationResult =
  | { ok: true; matchedDefinitions: number }
  | {
      ok: false;
      type: string;
      matchedDefinitions: number;
      issues: EventValidationIssue[];
    };

export type EventTypeSummary = {
  type: string;
  description: string;
  source: string;
  payloadExample?: unknown;
  schemaKind?: "event" | "payload";
  schema?: unknown;
};

const sourceSchema = z.string().min(1);
const channelSchema = z
  .object({
    provider: z.string().min(1),
    connection: z.string().min(1).optional(),
    workspaceId: z.string().min(1).optional(),
    spaceId: z.string().min(1),
    threadId: z.string().min(1).optional(),
    messageId: z.string().min(1).optional(),
  })
  .passthrough();

const commandSchema = z
  .object({
    action: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const eventEnvelopeSchema = z
  .object({
    channel: channelSchema,
    event: z
      .object({
        action: z.string().min(1),
      })
      .passthrough(),
    actor: z.record(z.string(), z.unknown()).optional(),
    text: z.string().optional(),
    data: z.unknown().optional(),
    raw: z.unknown().optional(),
  })
  .passthrough();

const auditToolPayloadSchema = z
  .object({
    tool: z.string().min(1),
    args: z.record(z.string(), z.unknown()).optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
  })
  .passthrough();

const coreEventShapes: EventShapeDefinition[] = [
  {
    type: "audit.skill.changed",
    description: "Typed, append-only audit record for a local agent skill mutation.",
    source: "core",
    eventSchema: SkillAuditEventSchema,
  },
  {
    type: "noop",
    description:
      "No-op event for intentional non-action outcomes; persisted for traceability but not actionable.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          reason: z.string().min(1).optional(),
          note: z.string().optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "message.created",
    description: "Human/agent message event in a channel.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          text: z.string().min(1),
          eventType: z.string().min(1).optional(),
          hopCount: z.number().int().nonnegative().optional(),
          inReplyTo: z.string().min(1).optional(),
          intent: z
            .union([
              z.boolean(),
              z
                .object({
                  id: z.string().min(1).optional(),
                  label: z.string().min(1).optional(),
                  timeoutMs: z.number().int().positive().optional(),
                  active: z.boolean().optional(),
                })
                .passthrough(),
            ])
            .optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "agent.scheduled.trigger",
    description:
      "Internal scheduled trigger for an agent. payload.targetAgentName must be an AGENT participant of channelId.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      payload: z
        .object({
          text: z.string().min(1),
          targetAgentName: z.string().min(1),
        })
        .passthrough(),
    }),
  },
  {
    type: "agent.intent.timeout",
    description:
      "Runner-generated timeout nudge when an agent-declared intent has not been followed by an actionable event.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          targetAgentName: z.string().min(1),
          intentId: z.string().min(1),
          intentMessageEventId: z.string().min(1),
          label: z.string().min(1).optional(),
          timeoutMs: z.number().int().positive(),
          timeoutCount: z.number().int().positive(),
          text: z.string().min(1).optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "agent.lifecycle.started",
    description: "Bootstrap event sent when agent runner starts an agent.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      payload: z
        .object({
          targetAgentName: z.string().min(1),
          text: z.string().min(1),
          startedAt: z.number().int(),
        })
        .passthrough(),
    }),
  },
  {
    type: "agent.turn.started",
    description: "Agent began handling a triggered turn in a channel.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          triggerEventId: z.string().min(1),
          eventCount: z.number().int().positive().optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "agent.turn.phase",
    description: "Agent emitted intermediate turn progress for UI status.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          triggerEventId: z.string().min(1),
          phase: z.string().min(1),
          detail: z.string().optional(),
          eventCount: z.number().int().positive().optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "agent.turn.completed",
    description: "Agent finished handling a triggered turn in a channel.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          triggerEventId: z.string().min(1),
          eventCount: z.number().int().positive().optional(),
          completedWithFallback: z.boolean().optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "agent.turn.failed",
    description: "Agent failed while handling a triggered turn in a channel.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          triggerEventId: z.string().min(1),
          eventCount: z.number().int().positive().optional(),
          error: z.string().min(1),
        })
        .passthrough(),
    }),
  },
  {
    type: "wrapper.lifecycle.started",
    description: "Wrapped runtime lifecycle started for an agent.",
    source: "core",
    payloadSchema: z
      .object({
        targetAgentName: z.string().min(1),
        kind: z.string().min(1).optional(),
        text: z.string().optional(),
      })
      .passthrough(),
  },
  {
    type: "wrapper.setup.started",
    description: "Wrapped runtime setup command started.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "wrapper.setup.skipped",
    description: "Wrapped runtime setup was not needed.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "wrapper.setup.completed",
    description: "Wrapped runtime setup completed successfully.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "wrapper.setup.failed",
    description: "Wrapped runtime setup failed.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "wrapper.sidecar.started",
    description: "Wrapped runtime sidecar process started.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "wrapper.sidecar.skipped",
    description: "Wrapped runtime sidecar was already healthy or not needed.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "wrapper.sidecar.exited",
    description: "Wrapped runtime sidecar process exited.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "wrapper.sidecar.failed",
    description: "Wrapped runtime sidecar process failed to start.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "wrapper.turn.started",
    description: "Wrapped runtime command started for a turn.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "wrapper.turn.completed",
    description: "Wrapped runtime command completed for a turn.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "wrapper.turn.failed",
    description: "Wrapped runtime command failed for a turn.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "channel.event.created",
    description: "Inbound external channel event envelope.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      payload: eventEnvelopeSchema,
    }),
  },
  {
    type: "channel.command.requested",
    description: "Outbound external channel command request.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      payload: z
        .object({
          channel: channelSchema,
          command: commandSchema,
          idempotencyKey: z.string().min(1).optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "channel.command.succeeded",
    description: "Outbound external channel command success.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      payload: z
        .object({
          channel: z.record(z.string(), z.unknown()),
          requestEventId: z.string().min(1),
          command: z.object({ action: z.string().min(1) }).passthrough(),
          target: z.record(z.string(), z.unknown()).optional(),
          result: z.unknown().optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "channel.command.failed",
    description: "Outbound external channel command failure.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      payload: z
        .object({
          channel: z.record(z.string(), z.unknown()),
          requestEventId: z.string().min(1),
          command: z.object({ action: z.string().min(1) }).passthrough(),
          error: z.string().min(1),
          retryable: z.boolean().optional(),
          details: z.unknown().optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "event.deadlettered",
    description: "Event moved to dead-letter after repeated failures.",
    source: "core",
    eventSchema: z.object({
      payload: z
        .object({
          eventId: z.string().min(1),
          failCount: z.number().int().nonnegative(),
        })
        .passthrough(),
    }),
  },
  {
    type: "telemetry.response.skipped",
    description: "Runner skipped final text response by agent directive.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      payload: z
        .object({
          eventType: z.string().min(1),
          reason: z.string().min(1),
          note: z.string().optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "session.summary.created",
    description: "Runner-generated summary for the active channel session.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          agentName: z.string().min(1),
          summary: z.string().min(1),
          sessionStartAt: z.number().int(),
          sessionEndAt: z.number().int(),
          eventCount: z.number().int().positive(),
        })
        .passthrough(),
    }),
  },
  {
    type: "telemetry.local-memory.recorded",
    description: "Runner recorded local memory updates for an agent.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          agentName: z.string().min(1),
          filePath: z.string().min(1),
          entriesWritten: z.number().int().nonnegative(),
          channelsProcessed: z.number().int().nonnegative(),
        })
        .passthrough(),
    }),
  },
  {
    type: "telemetry.context.window.updated",
    description: "Runner estimated context window usage for an agent turn.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          agentName: z.string().min(1),
          modelId: z.string().min(1),
          contextWindowTokens: z.number().int().positive(),
          estimatedUsedTokens: z.number().int().nonnegative(),
          estimatedAvailableTokens: z.number().int().nonnegative(),
          utilizationPct: z.number().nonnegative(),
          usageSource: z.enum(["estimate", "provider"]).optional(),
          inputTokens: z.number().int().nonnegative().optional(),
          outputTokens: z.number().int().nonnegative().optional(),
          totalTokens: z.number().int().nonnegative().optional(),
          reasoningTokens: z.number().int().nonnegative().optional(),
          cachedInputTokens: z.number().int().nonnegative().optional(),
          messageCount: z.number().int().positive(),
          systemChars: z.number().int().nonnegative(),
          systemContextChars: z.number().int().nonnegative(),
          historyChars: z.number().int().nonnegative(),
          triggerEventId: z.string().min(1).optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "telemetry.prompt.composed",
    description: "Runner captured the composed prompt/messages for an agent turn.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          agentName: z.string().min(1),
          modelId: z.string().min(1),
          memoryContextMode: z
            .enum(["PER_CHANNEL_CROSS_CHANNEL", "FULL_CHANNEL_EVENTS", "OFF"])
            .optional(),
          triggerEventId: z.string().min(1).optional(),
          systemPrompt: z.string(),
          systemContextMessages: z.array(z.string()).optional(),
          messages: z
            .array(
              z.object({
                role: z.string().min(1),
                content: z.string(),
              }),
            )
            .optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "audit.catalog.configuration.changed",
    description: "Catalog configuration mutation audit.",
    source: "core",
    payloadSchema: CatalogConfigurationAuditSchema,
  },
  ...[
    ["audit.catalog.source.changed", "Catalog source mutation audit."],
    ["audit.catalog.sync.completed", "Catalog source synchronization completion audit."],
    ["audit.catalog.sync.failed", "Catalog source synchronization failure audit."],
    ["audit.catalog.release.reviewed", "Catalog release review audit."],
    ["audit.catalog.grant.changed", "Catalog release grant mutation audit."],
    ["audit.catalog.installation.changed", "Catalog package installation audit."],
    ["audit.catalog.api_activation.changed", "Catalog API event-shape approval and activation audit."],
    ["audit.catalog.template.instantiated", "Catalog template instantiation audit."],
    ["audit.catalog.secret_binding.changed", "Catalog agent secret-binding mutation audit."],
    ["audit.catalog.rollout.changed", "Catalog rollout mutation audit."],
    ["audit.catalog.deployment.reported", "Catalog runner deployment report audit."],
  ].map(([type, description]) => ({
    type,
    description,
    source: "core" as const,
    eventSchema: CatalogAuditEventSchema,
  })),
  {
    type: "audit.catalog.assignment.changed",
    description: "Catalog skill assignment mutation audit.",
    source: "core",
    eventSchema: CatalogAssignmentAuditEventSchema,
  },
  {
    type: "audit.events.cleared",
    description: "Audit record for event clear operation.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "audit.secret.set",
    description: "Audit record for secret updates.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "audit.secret.accessed",
    description: "Audit record for secret access.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "audit.secret.deleted",
    description: "Audit record for secret deletion.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  ...(
    [
      "audit.memory.channel.recent.tool_refresh",
      "audit.memory.channel.recent.tool_update",
      "audit.memory.channel.full.tool_refresh",
      "audit.memory.channel.full.tool_update",
      "audit.memory.cross.recent.tool_refresh",
      "audit.memory.cross.recent.tool_update",
      "audit.memory.cross.full.tool_refresh",
      "audit.memory.cross.full.tool_update",
    ] as const
  ).map((type) => ({
    type,
    description: "Audit record for agent memory tool usage.",
    source: "core" as const,
    payloadSchema: z.record(z.string(), z.unknown()),
  })),
  {
    type: "audit.workspace.cleaned",
    description: "Audit record for workspace cleanup.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "tool.started",
    description: "Audit record for tool invocation start.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1).optional(),
      payload: auditToolPayloadSchema,
    }),
  },
  {
    type: "tool.executed",
    description: "Audit record for successful tool invocation.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1).optional(),
      payload: auditToolPayloadSchema,
    }),
  },
  {
    type: "tool.failed",
    description: "Audit record for failed tool invocation.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1).optional(),
      payload: auditToolPayloadSchema,
    }),
  },
  {
    type: "telemetry.rlm.repl_input",
    description: "Audit record for RLM REPL input.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "telemetry.rlm.repl_output",
    description: "Audit record for RLM REPL output.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "telemetry.rlm.repl_output.error",
    description: "Audit record for RLM REPL execution errors.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "telemetry.rlm.subagent.started",
    description: "Audit record for RLM subagent start.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "telemetry.rlm.subagent.finished",
    description: "Audit record for RLM subagent completion.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "telemetry.rlm.done",
    description: "Audit record for RLM done() completion.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "telemetry.rlm.max_steps_reached",
    description: "Audit record for RLM reaching step budget.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "process.started",
    description: "Process lifecycle event emitted by runner.",
    source: "core",
    payloadSchema: z
      .object({
        processId: z.string().min(1),
        cmd: z.string().min(1),
      })
      .passthrough(),
  },
  {
    type: "process.output",
    description: "Process output event.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "process.exited",
    description: "Process exited event.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "processes.cleared",
    description: "Process clear operation event.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "agent.control.start",
    description: "Agent lifecycle control command.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "agent.control.stop",
    description: "Agent lifecycle control command.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "agent.control.restart",
    description: "Agent lifecycle control command.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "agent.control.reload-skills",
    description: "Agent lifecycle control command.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "agent.control.cleanup-workspace",
    description: "Agent lifecycle control command.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
];

export function getCoreEventShapes(): EventShapeDefinition[] {
  return coreEventShapes;
}

function formatIssues(prefix: string, result: z.SafeParseError<unknown>): string[] {
  return result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${prefix}${path}: ${issue.message}`;
  });
}

export function validateEventAgainstShapes(
  event: EventDraft,
  definitions: readonly EventShapeDefinition[],
): EventValidationResult {
  const matching = definitions.filter((definition) => definition.type === event.type);
  if (matching.length === 0) {
    return {
      ok: false,
      type: event.type,
      matchedDefinitions: 0,
      issues: [
        {
          source: "core",
          message: `Unsupported event type: ${event.type}`,
        },
      ],
    };
  }

  const collected: EventValidationIssue[] = [];
  for (const definition of matching) {
    let definitionSource = "core";
    try {
      definitionSource = definition.source ?? "core";
      const schema = definition.eventSchema ?? definition.payloadSchema;
      if (!schema) return { ok: true, matchedDefinitions: matching.length };
      const parsed: unknown = schema.safeParse(definition.eventSchema ? event : event.payload);
      if (!parsed || typeof parsed !== "object" || typeof (parsed as { success?: unknown }).success !== "boolean") {
        throw new Error("malformed schema result");
      }
      if ((parsed as { success: boolean }).success) {
        if (!("data" in parsed)) throw new Error("malformed schema result");
        return { ok: true, matchedDefinitions: matching.length };
      }
      const error = (parsed as { error?: { issues?: unknown } }).error;
      if (!error || !Array.isArray(error.issues)) throw new Error("malformed schema result");
      for (const message of formatIssues(definition.eventSchema ? "" : "payload.", parsed as z.SafeParseError<unknown>)) {
        collected.push({ source: definitionSource, message });
      }
    } catch {
      collected.push({ source: definitionSource, message: "Schema validation failed" });
    }
  }

  return {
    ok: false,
    type: event.type,
    matchedDefinitions: matching.length,
    issues: collected,
  };
}

export function serializeEventShapes(
  definitions: readonly EventShapeDefinition[],
): EventTypeSummary[] {
  const schemaName = (type: string, kind: "event" | "payload") =>
    `${type.replace(/[^a-zA-Z0-9_]/g, "_")}_${kind}`;
  const schemaToJson = (
    schema: z.ZodTypeAny,
    type: string,
    kind: "event" | "payload",
  ): unknown => {
    try {
      const immutable = (schema as unknown as { [IMMUTABLE_EVENT_SCHEMA_JSON]?: unknown })[IMMUTABLE_EVENT_SCHEMA_JSON];
      return immutable ?? zodToJsonSchema(schema, schemaName(type, kind));
    } catch {
      return { error: "schema_serialization_failed" };
    }
  };
  return definitions.map((definition) => ({
    type: definition.type,
    description: definition.description,
    source: definition.source ?? "core",
    payloadExample: definition.payloadExample,
    ...(definition.eventSchema
      ? {
          schemaKind: "event" as const,
          schema: schemaToJson(definition.eventSchema, definition.type, "event"),
        }
      : {}),
    ...(definition.payloadSchema
      ? {
          schemaKind: "payload" as const,
          schema: schemaToJson(definition.payloadSchema, definition.type, "payload"),
        }
      : {}),
  }));
}

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export type EventDraft = {
  type: string;
  payload: unknown;
  source: string;
  channelId?: string;
  parentEventId?: string;
  deliverAt?: number;
  idempotencyKey?: string;
};

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
    type: "audit.response.skipped",
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
    type: "audit.local-memory.recorded",
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
    type: "audit.context.window.updated",
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
    type: "audit.prompt.composed",
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
    type: "audit.workspace.cleaned",
    description: "Audit record for workspace cleanup.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "audit.process.started",
    description: "Audit record for process start.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "audit.process.output",
    description: "Audit record for process output chunk.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "audit.process.exited",
    description: "Audit record for process exit.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "audit.tool.started",
    description: "Audit record for tool invocation start.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1).optional(),
      payload: auditToolPayloadSchema,
    }),
  },
  {
    type: "audit.tool.executed",
    description: "Audit record for successful tool invocation.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1).optional(),
      payload: auditToolPayloadSchema,
    }),
  },
  {
    type: "audit.tool.failed",
    description: "Audit record for failed tool invocation.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1).optional(),
      payload: auditToolPayloadSchema,
    }),
  },
  {
    type: "audit.rlm.repl_input",
    description: "Audit record for RLM REPL input.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "audit.rlm.repl_output",
    description: "Audit record for RLM REPL output.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "audit.rlm.repl_output.error",
    description: "Audit record for RLM REPL execution errors.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "audit.rlm.subagent.started",
    description: "Audit record for RLM subagent start.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "audit.rlm.subagent.finished",
    description: "Audit record for RLM subagent completion.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "audit.rlm.done",
    description: "Audit record for RLM done() completion.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "audit.rlm.max_steps_reached",
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
  definitions: EventShapeDefinition[],
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
    const definitionSource = definition.source ?? "core";
    if (definition.eventSchema) {
      const parsed = definition.eventSchema.safeParse(event);
      if (parsed.success) return { ok: true, matchedDefinitions: matching.length };
      for (const message of formatIssues("", parsed)) {
        collected.push({ source: definitionSource, message });
      }
      continue;
    }
    if (definition.payloadSchema) {
      const parsed = definition.payloadSchema.safeParse(event.payload);
      if (parsed.success) return { ok: true, matchedDefinitions: matching.length };
      for (const message of formatIssues("payload.", parsed)) {
        collected.push({ source: definitionSource, message });
      }
      continue;
    }
    return { ok: true, matchedDefinitions: matching.length };
  }

  return {
    ok: false,
    type: event.type,
    matchedDefinitions: matching.length,
    issues: collected,
  };
}

export function serializeEventShapes(
  definitions: EventShapeDefinition[],
): EventTypeSummary[] {
  const schemaName = (type: string, kind: "event" | "payload") =>
    `${type.replace(/[^a-zA-Z0-9_]/g, "_")}_${kind}`;
  const schemaToJson = (
    schema: z.ZodTypeAny,
    type: string,
    kind: "event" | "payload",
  ): unknown => {
    try {
      return zodToJsonSchema(schema, schemaName(type, kind));
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

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

const targetAgentNamesSchema = z.array(z.string().trim().min(1)).min(1).max(30).optional();

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
          targetAgentNames: targetAgentNamesSchema,
          sensitive: z
            .object({
              ciphertextB64: z.string().min(1).optional(),
              plaintext: z.string().min(1).optional(),
              text: z.string().min(1).optional(),
              value: z.string().min(1).optional(),
              previewText: z.string().min(1).optional(),
              algorithm: z.string().min(1).optional(),
              hint: z.string().min(1).optional(),
              requiresPassword: z.boolean().optional(),
            })
            .passthrough()
            .refine(
              (value) =>
                Boolean(value.ciphertextB64 || value.plaintext || value.text || value.value),
              {
                message:
                  "sensitive requires ciphertextB64 or plaintext/text/value for API-side encryption",
              },
            )
            .optional(),
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
    type: "voice.room.started",
    description:
      "A channel voice room started. Bookkeeping/signaling only; media is carried by the configured voice broker, not the event log.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          roomId: z.string().min(1),
          sessionId: z.string().min(1),
          broker: z.string().min(1),
          agentNames: z.array(z.string().min(1)).optional(),
          startedAt: z.number().int().nonnegative(),
          text: z.string().optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "voice.room.ended",
    description: "A channel voice room ended. Bookkeeping/signaling only.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          roomId: z.string().min(1),
          sessionId: z.string().min(1).optional(),
          endedAt: z.number().int().nonnegative(),
          reason: z.string().min(1).optional(),
          text: z.string().optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "voice.session.started",
    description:
      "A participant joined live voice in a channel. Presence bookkeeping only; never wakes agents.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          sessionId: z.string().min(1),
          startedAt: z.number().int().nonnegative(),
          text: z.string().optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "voice.session.ended",
    description: "A participant left live voice in a channel. Presence bookkeeping only.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          sessionId: z.string().min(1),
          endedAt: z.number().int().nonnegative(),
          reason: z.string().min(1).optional(),
          text: z.string().optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "voice.participant.muted",
    description: "A live voice participant changed their own mute state. Presence bookkeeping only.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          sessionId: z.string().min(1),
          participantId: z.string().min(1),
          participantKind: z.enum(["HUMAN", "AGENT"]).optional(),
          muted: z.boolean(),
          text: z.string().optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "voice.active_speaker.changed",
    description:
      "Live voice active-speaker hint, emitted when a participant starts an utterance. Lets single-stream consumers follow the current speaker.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          sessionId: z.string().min(1),
          streamId: z.string().min(1),
          speakerId: z.string().min(1),
          text: z.string().optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "voice.realtime.call.started",
    description:
      "A provider realtime media leg (WebRTC) started for a realtime-capable agent in a channel voice room. The agent's runner attaches to the call, supplies instructions and tools, and records both sides' transcripts as message.created with payload.voice.mode=realtime. Never starts a text turn.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          targetAgentName: z.string().min(1),
          callId: z.string().min(1),
          sessionId: z.string().min(1),
          roomId: z.string().min(1).optional(),
          provider: z.string().min(1),
          model: z.string().min(1),
          transport: z.enum(["webrtc", "livekit"]).optional(),
          speakerId: z.string().min(1),
          startedAt: z.number().int().nonnegative(),
          text: z.string().optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "voice.realtime.call.ended",
    description:
      "A realtime voice room media leg ended (human hung up, page closed, or the runner's connection to the call closed).",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          targetAgentName: z.string().min(1),
          callId: z.string().min(1),
          sessionId: z.string().min(1).optional(),
          roomId: z.string().min(1).optional(),
          endedAt: z.number().int().nonnegative(),
          reason: z.string().min(1).optional(),
          text: z.string().optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "voice.input.chunk",
    description:
      "One self-contained spoken utterance (hold-to-talk voice message or a live voice segment). The API channel transcriber turns it into a message.created from the speaker with payload.voice; agents read that message, not the raw chunk.",
    source: "core",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: sourceSchema,
      payload: z
        .object({
          mode: z.enum(["message", "live"]),
          speakerId: z.string().min(1),
          sessionId: z.string().min(1).optional(),
          streamId: z.string().min(1).optional(),
          chunkIndex: z.number().int().nonnegative().optional(),
          startedAt: z.number().int().nonnegative(),
          endedAt: z.number().int().nonnegative(),
          durationMs: z.number().int().nonnegative().optional(),
          attachment: z
            .object({
              fileId: z.string().min(1),
              name: z.string().min(1).optional(),
              mime: z.string().min(1).optional(),
              size: z.number().int().nonnegative().optional(),
            })
            .passthrough(),
          text: z.string().optional(),
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
          noReply: z.boolean().optional(),
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
    type: "audit.secret.deleted",
    description: "Audit record for secret deletion.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "audit.sensitive_message.revealed",
    description: "Audit record for revealing encrypted sensitive message content.",
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
  ...(
    [
      "audit.workspace_publication.created",
      "audit.workspace_publication.updated",
      "audit.workspace_publication.deleted",
    ] as const
  ).map((type) => ({
    type,
    description: "Audit record for workspace publication management.",
    source: "core" as const,
    payloadSchema: z.record(z.string(), z.unknown()),
  })),
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
  {
    type: "agent.control.copy",
    description: "Agent copy management command.",
    source: "core",
    payloadSchema: z.record(z.string(), z.unknown()),
  },
  {
    type: "agent.control.move",
    description: "Agent runner reassignment management command.",
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

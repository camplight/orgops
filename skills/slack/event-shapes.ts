import { z } from "zod";
import type { EventShapeDefinition } from "@orgops/schemas";

export const eventShapes: EventShapeDefinition[] = [
  {
    type: "message.created",
    description:
      "Outbound Slack bridge message (agent-authored). Listener forwards this to Slack when channel is a slack:* integration bridge.",
    source: "skill:slack",
    eventSchema: z.object({
      source: z.string().regex(/^agent:/),
      channelId: z.string().min(1),
      payload: z
        .object({
          text: z.string().min(1),
          threadTs: z.string().min(1).optional(),
        })
        .passthrough(),
    }),
    payloadExample: {
      text: "Working on it",
      threadTs: "1710000000.000100",
    },
  },
  {
    type: "channel.command.requested",
    description:
      "Outbound Slack command request envelope. Listener executes payload.command.action via Slack Web API for bridged channels.",
    source: "skill:slack",
    eventSchema: z.object({
      source: z.string().regex(/^agent:/),
      channelId: z.string().min(1),
      payload: z
        .object({
          channel: z
            .object({
              provider: z.literal("slack"),
              connection: z.string().min(1).optional(),
              workspaceId: z.string().min(1).optional(),
              spaceId: z.string().min(1).optional(),
            })
            .passthrough(),
          command: z
            .object({
              action: z.string().min(1),
              payload: z.record(z.string(), z.unknown()).optional(),
            })
            .passthrough(),
        })
        .passthrough(),
    }),
    payloadExample: {
      channel: {
        provider: "slack",
        connection: "worker1",
        workspaceId: "T123",
        spaceId: "C456",
      },
      command: {
        action: "chat.postMessage",
        payload: {
          text: "hello from command envelope",
        },
      },
    },
  },
  {
    type: "channel.event.created",
    description: "Slack inbound event envelope routed through integration bridge.",
    source: "skill:slack",
    eventSchema: z.object({
      channelId: z.string().min(1),
      source: z.string().regex(/^channel:slack:/),
      payload: z
        .object({
          channel: z
            .object({
              provider: z.literal("slack"),
              connection: z.string().min(1),
              workspaceId: z.string().min(1),
              spaceId: z.string().min(1),
              threadId: z.string().min(1).optional(),
              messageId: z.string().min(1).optional(),
            })
            .passthrough(),
          event: z
            .object({
              action: z.enum(["message_created", "app_mention"]),
            })
            .passthrough(),
          actor: z.record(z.string(), z.unknown()).optional(),
          text: z.string().optional(),
          data: z.record(z.string(), z.unknown()).optional(),
        })
        .passthrough(),
    }),
  },
  {
    type: "slack.file.fetched",
    description: "Slack file downloaded to local path for agent processing.",
    source: "skill:slack",
    eventSchema: z.object({
      channelId: z.string().min(1),
      payload: z
        .object({
          fileId: z.string().min(1),
          path: z.string().min(1),
          mime: z.string().nullable(),
          size: z.number().int().nonnegative(),
          name: z.string().nullable(),
          title: z.string().nullable(),
          url_private_download: z.string().nullable(),
        })
        .passthrough(),
    }),
  },
];

import { describe, expect, it } from "vitest";
import { SkillInventoryItemSchema, TrustedLocalSkillRefSchema } from "./index";
import {
  EventSchema,
  getCoreEventShapes,
  validateEventAgainstShapes,
} from "./index";

describe("schemas", () => {
  it("validates event payload", () => {
    const parsed = EventSchema.safeParse({
      type: "message.created",
      payload: { text: "hello" },
      source: "human:admin",
    });
    expect(parsed.success).toBe(true);
  });

  it("validates typed core event shapes", () => {
    const result = validateEventAgainstShapes(
      {
        type: "message.created",
        source: "human:admin",
        channelId: "chan-1",
        payload: { text: "hello" },
      },
      getCoreEventShapes(),
    );
    expect(result.ok).toBe(true);
  });

  it("validates message.created with intent metadata", () => {
    const result = validateEventAgainstShapes(
      {
        type: "message.created",
        source: "agent:worker-a",
        channelId: "chan-1",
        payload: {
          text: "I will do this shortly.",
          intent: {
            id: "intent-1",
            label: "follow up with concrete output",
            timeoutMs: 45_000,
          },
        },
      },
      getCoreEventShapes(),
    );
    expect(result.ok).toBe(true);
  });

  it("validates agent.intent.timeout core event shape", () => {
    const result = validateEventAgainstShapes(
      {
        type: "agent.intent.timeout",
        source: "system:runner:intent-watchdog",
        channelId: "chan-1",
        payload: {
          targetAgentName: "worker-a",
          intentId: "intent-1",
          intentMessageEventId: "evt-message-1",
          timeoutMs: 45_000,
          timeoutCount: 1,
          text: "Intent has not been acted on yet.",
        },
      },
      getCoreEventShapes(),
    );
    expect(result.ok).toBe(true);
  });

  it("validates noop core event shape", () => {
    const result = validateEventAgainstShapes(
      {
        type: "noop",
        source: "agent:worker-a",
        channelId: "chan-1",
        payload: { reason: "not_mentioned_in_group_channel" },
      },
      getCoreEventShapes(),
    );
    expect(result.ok).toBe(true);
  });

  it("returns shape issues for invalid event payload", () => {
    const result = validateEventAgainstShapes(
      {
        type: "message.created",
        source: "human:admin",
        channelId: "chan-1",
        payload: { text: "" },
      },
      getCoreEventShapes(),
    );
    expect(result.ok).toBe(false);
  });
});

describe("unified skill schemas", () => {
  it("keeps unified inventory projections strict", () => {
    expect(TrustedLocalSkillRefSchema.safeParse({ kind: "LOCAL", name: "tool", localOrigin: "WORKSPACE", trustedRootKey: "workspace" }).success).toBe(true);
    expect(SkillInventoryItemSchema.safeParse({
      ref: { kind: "LOCAL", name: "tool", localOrigin: "WORKSPACE" }, description: "A tool",
      readiness: { state: "READY" }, provenance: "BOUNDED_HUMAN", extra: true,
    }).success).toBe(false);
  });
});

describe("catalog assignment history audit", () => {
  const payload = {
    actorKind: "HUMAN_ADMIN", actorId: "human-owner", agentId: "agent-1", releaseId: "release-1",
    operation: "ASSIGN", outcome: "SUCCEEDED", revision: 1, deploymentId: "deployment-1",
    desiredGeneration: "generation-1", effectiveGeneration: null, state: "REQUESTED", failureCode: null,
  };
  it("accepts the exact immutable command snapshot", () => {
    expect(validateEventAgainstShapes({ type: "audit.catalog.assignment.changed", source: "system", status: "DELIVERED", channelId: null, payload } as any, getCoreEventShapes()).ok).toBe(true);
  });
  it.each([
    { operation: "LOCAL_BATCH" },
    { state: "SUCCEEDED" },
    { failureCode: "ARBITRARY" },
    { extra: true },
  ])("rejects malformed assignment snapshots %#", mutation => {
    expect(validateEventAgainstShapes({ type: "audit.catalog.assignment.changed", source: "system", status: "DELIVERED", channelId: null, payload: { ...payload, ...mutation } } as any, getCoreEventShapes()).ok).toBe(false);
  });
});

describe("catalog configuration core audit", () => {
  const payload = {actorHumanId:"human-owner",sourceId:"team-source",action:"source.create",revision:1};
  it("validates the redacted system audit", () => {
    const event = {type:"audit.catalog.configuration.changed",source:"system",status:"DELIVERED",payload};
    expect(validateEventAgainstShapes(event,getCoreEventShapes()).ok).toBe(true);
  });
  it.each(["username","password","ciphertext_b64","credentialRef","url","displayName","ref"])("rejects audit passthrough %s", key => {
    expect(validateEventAgainstShapes({type:"audit.catalog.configuration.changed",source:"system",payload:{...payload,[key]:"synthetic"}},getCoreEventShapes()).ok).toBe(false);
  });
});

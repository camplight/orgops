import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunnerApi } from "../runner/api";
import { createRunnerState } from "../runner/state";
import { createTurnExecutor } from "../turn-executor";
import type { ChannelRecord } from "../models/channel";
import type { Agent, Event } from "../types";
import { API_ORIGIN } from "./orgops-api";

export const getMockAgent = (overrides?: Partial<Agent>): Agent => ({
  name: "alice",
  systemInstructions: "You are alice.",
  soulPath: "",
  workspacePath: "/workspaces/alice",
  modelId: "openrouter:test-model",
  desiredState: "RUNNING",
  runtimeState: "RUNNING",
  ...overrides,
});

export const getMockEvent = (overrides?: Partial<Event>): Event => ({
  id: "evt-1",
  type: "message.created",
  source: "human:admin",
  channelId: "chan-1",
  payload: { text: "hello" },
  createdAt: 1_000,
  ...overrides,
});

export const getMockChannelRecord = (overrides?: Partial<ChannelRecord>): ChannelRecord => ({
  id: "chan-1",
  name: "general",
  kind: "TEAM",
  participants: [{ subscriberType: "AGENT", subscriberId: "alice" }],
  ...overrides,
});

export const getMockExecutor = (overrides?: { llmCallTimeoutMs?: number }) => {
  const scratch = mkdtempSync(join(tmpdir(), "turn-executor-"));
  const api = createRunnerApi({
    apiUrl: API_ORIGIN,
    runnerToken: "test-runner-token",
    heartbeatIntervalMs: 1_000,
    runnerIdFile: join(scratch, ".agent-runner-id"),
    runnerState: createRunnerState(),
  });
  return createTurnExecutor({
    projectRoot: "/orgops",
    skillRoots: [],
    llmCallTimeoutMs: overrides?.llmCallTimeoutMs ?? 5_000,
    api,
  });
};

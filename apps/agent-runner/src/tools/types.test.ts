import { expect, it } from "vitest";
import { createWrapExecute } from "./types";

it("preserves a successful void tool result when bounding persisted output", async () => {
  const emitted: Array<{ type?: string; payload?: unknown }> = [];
  const execute = createWrapExecute({
    agent: {
      name: "tester",
      workspacePath: "/tmp",
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    },
    event: { id: "trigger", type: "message.created", source: "human:test", payload: {} },
    channelId: "chat",
    runTool: async () => undefined,
    apiFetch: async () => { throw new Error("A successful tool must not fail its trigger"); },
    emitEvent: async (event) => { emitted.push(event as typeof emitted[number]); },
  })("shell_run");

  expect(await execute({ cmd: "true" })).toBeUndefined();
  expect(emitted.map((event) => event.type)).toEqual(["tool.started", "tool.executed"]);
});

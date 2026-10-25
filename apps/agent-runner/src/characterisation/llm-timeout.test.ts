import { describe, expect, it } from "vitest";
import { resolveAgentLlmCallTimeoutMs } from "../turn-executor";
import { setUpTurn } from "./attempt-loop-support";
import { getMockAgent } from "./factories";
import { answersAfter, modelEvents, neverAnswers } from "./injection-support";
import { useFakeNetwork } from "./lifecycle";
import { chatCompletion, replyWithEvent, replyWithText } from "./provider";

useFakeNetwork();

const SHORT_TIMEOUT_MS = 30;
const finalAnswer = replyWithEvent({ type: "message.created", payload: { text: "final" } });
const timedOutMessage = (attempt: number, timeoutMs: number) =>
  `LLM generate (attempt ${attempt}) timed out after ${timeoutMs}ms`;

describe("LLM call timeout: a call that never answers", () => {
  it("rejects with the attempt number and the timeout", async () => {
    const { provider, run } = setUpTurn({
      llmCallTimeoutMs: SHORT_TIMEOUT_MS,
      responders: [neverAnswers],
    });

    await expect(run()).rejects.toThrow(timedOutMessage(1, SHORT_TIMEOUT_MS));
    expect(provider.requests).toHaveLength(1);
  });

  it("emits no model event and no completed event", async () => {
    const { orgops, run } = setUpTurn({ llmCallTimeoutMs: SHORT_TIMEOUT_MS, responders: [neverAnswers] });

    await expect(run()).rejects.toThrow("timed out");

    expect(modelEvents(orgops.emitted())).toEqual([]);
    expect(orgops.emitted().map((event) => event.type)).not.toContain("agent.turn.completed");
  });

  it("does not retry after a timeout", async () => {
    const { provider, run } = setUpTurn({
      llmCallTimeoutMs: SHORT_TIMEOUT_MS,
      responders: [neverAnswers, finalAnswer],
    });

    await expect(run()).rejects.toThrow("timed out");

    expect(provider.requests).toHaveLength(1);
  });

  it("names the attempt that timed out", async () => {
    const { provider, run } = setUpTurn({
      llmCallTimeoutMs: SHORT_TIMEOUT_MS,
      responders: [replyWithText("not json"), neverAnswers],
    });

    await expect(run()).rejects.toThrow(timedOutMessage(2, SHORT_TIMEOUT_MS));
    expect(provider.requests).toHaveLength(2);
  });

  it("covers the whole tool loop of an attempt, not only the first request", async () => {
    const { provider, run } = setUpTurn({
      llmCallTimeoutMs: SHORT_TIMEOUT_MS * 2,
      responders: [
        () => chatCompletion({ toolCalls: [{ id: "call-1", name: "events_channels_list", arguments: {} }] }),
        neverAnswers,
      ],
    });

    await expect(run()).rejects.toThrow(timedOutMessage(1, SHORT_TIMEOUT_MS * 2));
    expect(provider.requests).toHaveLength(2);
  });
});

describe("LLM call timeout: a call that answers in time", () => {
  it("gives every attempt its own timeout", async () => {
    const answerDelay = 50;
    const { orgops, provider, run } = setUpTurn({
      llmCallTimeoutMs: 80,
      responders: [answersAfter(answerDelay, replyWithText("not json")), answersAfter(answerDelay, finalAnswer)],
    });

    await run();

    expect(provider.requests).toHaveLength(2);
    expect(modelEvents(orgops.emitted())).toHaveLength(1);
  });

  it("does not fail the turn once the answer has arrived", async () => {
    const { orgops, run } = setUpTurn({ llmCallTimeoutMs: 80, responders: [finalAnswer] });

    await run();

    expect(orgops.emitted().map((event) => event.type)).toContain("agent.turn.completed");
  });
});

describe("LLM call timeout: where the limit comes from", () => {
  it("uses the agent's limit before the executor's", async () => {
    const { run } = setUpTurn({
      agent: { llmCallTimeoutMs: SHORT_TIMEOUT_MS },
      llmCallTimeoutMs: 5_000,
      responders: [neverAnswers],
    });

    await expect(run()).rejects.toThrow(timedOutMessage(1, SHORT_TIMEOUT_MS));
  });

  it("floors a fractional agent limit", async () => {
    const { run } = setUpTurn({
      agent: { llmCallTimeoutMs: 30.9 },
      llmCallTimeoutMs: 5_000,
      responders: [neverAnswers],
    });

    await expect(run()).rejects.toThrow(timedOutMessage(1, 30));
  });

  it("uses the executor's limit when the agent has none", async () => {
    const { run } = setUpTurn({ llmCallTimeoutMs: 40, responders: [neverAnswers] });

    await expect(run()).rejects.toThrow(timedOutMessage(1, 40));
  });

  it.each([
    ["zero", 0],
    ["negative", -5],
    ["not a number", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ])("[quirk] falls back to the executor's limit when the agent's limit is %s", async (_name, invalid) => {
    const { run } = setUpTurn({
      agent: { llmCallTimeoutMs: invalid },
      llmCallTimeoutMs: 40,
      responders: [neverAnswers],
    });

    await expect(run()).rejects.toThrow(timedOutMessage(1, 40));
  });

  it("[quirk] the exported resolver ignores the executor's limit that executeTurn falls back to", () => {
    expect(resolveAgentLlmCallTimeoutMs(getMockAgent({ llmCallTimeoutMs: 30.9 }))).toBe(30);
    expect(resolveAgentLlmCallTimeoutMs(getMockAgent({ llmCallTimeoutMs: 0 }))).toBe(10_800_000);
  });
});

import { describe, expect, it } from "vitest";
import { resolveModelCapabilities, resolveReplyContract } from "./model-capabilities";

describe("replyContract capability", () => {
  it("defaults OpenAI realtime models to plain-text replies and others to JSON", () => {
    expect(resolveModelCapabilities("openai", "gpt-realtime").replyContract).toBe("plain-text");
    expect(resolveReplyContract("openai:gpt-realtime")).toBe("plain-text");
    expect(resolveReplyContract("openai:gpt-5")).toBe("json");
    expect(resolveReplyContract("anthropic:claude-4-sonnet")).toBe("json");
  });

  it("lets model defaults override the inferred contract", () => {
    const plain = resolveModelCapabilities("openai", "gpt-5", { capabilities: { replyContract: "plain-text" } });
    const json = resolveModelCapabilities("openai", "gpt-realtime", { capabilities: { replyContract: "json" } });
    expect(resolveReplyContract("openai:gpt-5", plain)).toBe("plain-text");
    expect(resolveReplyContract("openai:gpt-realtime", json)).toBe("json");
  });

  it("drops invalid contract values", () => {
    const caps = resolveModelCapabilities("openai", "gpt-5", { capabilities: { replyContract: "xml" } });
    expect(caps.replyContract).toBeUndefined();
  });

  it("infers realtime audio for Gemini Live and Liquid audio models", () => {
    expect(resolveModelCapabilities("google", "gemini-2.5-flash-native-audio-preview-09-2025")).toMatchObject({
      realtimeAudioInput: true,
      realtimeAudioOutput: true,
      classicTurns: false,
    });
    expect(resolveModelCapabilities("gemini", "gemini-2.0-flash-live-001").realtimeAudioInput).toBe(true);
    expect(resolveModelCapabilities("liquid", "lfm3-audio-2b")).toMatchObject({
      realtimeAudioInput: true,
      audioOutput: true,
    });
    expect(resolveModelCapabilities("openai-compatible", "LFM3-Omni-2B").realtimeAudioInput).toBe(true);
  });
});

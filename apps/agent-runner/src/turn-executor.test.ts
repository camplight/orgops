import { describe, expect, it } from "vitest";
import { normalizeFallbackMessageText } from "./turn-executor";

describe("normalizeFallbackMessageText", () => {
  it("extracts payload.text from JSON event output", () => {
    const raw = JSON.stringify(
      {
        type: "message.created",
        payload: { text: "clean fallback text" },
      },
      null,
      2,
    );

    expect(normalizeFallbackMessageText(raw)).toBe("clean fallback text");
  });

  it("extracts payload.text from fenced JSON event output", () => {
    const raw = [
      "```json",
      '{ "type": "message.created", "payload": { "text": "from fenced json" } }',
      "```",
    ].join("\n");

    expect(normalizeFallbackMessageText(raw)).toBe("from fenced json");
  });

  it("returns a friendly error for JSON without payload.text", () => {
    const raw = JSON.stringify(
      {
        type: "message.created",
        payload: { eventType: "status" },
      },
      null,
      2,
    );

    expect(normalizeFallbackMessageText(raw)).toContain("response-format issue");
  });

  it("keeps plain text unchanged", () => {
    expect(normalizeFallbackMessageText("plain fallback text")).toBe("plain fallback text");
  });

  it.each([
    'prose\n\n{"type":"message.created","payload":{"text":"hello"}}',
    'prose with { unmatched brace\n{"type":"message.created","payload":{"text":"hello"}}',
  ])("unwraps a trailing unfenced envelope: %s", (text) => {
    expect(normalizeFallbackMessageText(text)).toBe("hello");
  });

  it("handles braces and escaped quotes inside trailing JSON strings", () => {
    const text = "hello } { \"quoted\" \\";
    expect(
      normalizeFallbackMessageText(
        `prose\n${JSON.stringify({ type: "message.created", payload: { text } })}`,
      ),
    ).toBe(text);
  });

  it("preserves prose containing ordinary JSON examples", () => {
    const text = 'Use this config: {"setting":true}';
    expect(normalizeFallbackMessageText(text)).toBe(text);
  });
});

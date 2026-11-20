import { describe, expect, it } from "vitest";
import {
  clampCompletionRetrySeconds,
  completionFromJson,
  completionFromPlainText,
  scheduledCompletionAttempt,
} from "./turn-completion";

describe("turn completion parsing", () => {
  it("parses and strips the plain-text fallback trailer", () => {
    expect(
      completionFromPlainText(
        "The provider is rate-limited.\nORGOPS_TURN_STATUS: RETRY_LATER 90",
      ),
    ).toEqual({
      status: "RETRY_LATER",
      message: "The provider is rate-limited.",
      retryAfterSeconds: 90,
      source: "text",
    });
  });

  it("extracts fallback JSON control fields without retaining them in the event", () => {
    expect(
      completionFromJson(
        JSON.stringify({
          turnStatus: "WORK_FULLY_COMPLETE",
          type: "message.created",
          payload: { text: "done" },
        }),
      ),
    ).toEqual({
      status: "WORK_FULLY_COMPLETE",
      event: {
        type: "message.created",
        payload: { text: "done" },
      },
      source: "json",
    });
  });

  it("bounds retry delays and reads scheduled-attempt metadata defensively", () => {
    expect(clampCompletionRetrySeconds(1)).toBe(5);
    expect(clampCompletionRetrySeconds(99_999)).toBe(3_600);
    expect(scheduledCompletionAttempt({ turnCompletionAttempt: 2 })).toBe(2);
    expect(scheduledCompletionAttempt({ turnCompletionAttempt: -1 })).toBe(0);
  });
});

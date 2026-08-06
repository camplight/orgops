import { describe, expect, it } from "vitest";
import { parseClassificationResponse } from "./classifier";
import type { ClassificationResult } from "./types";

// Unit tests for the pure parsing/validation core of the Classifier (US-01/US-02/US-03).
// classifyTicketContent itself (the thin async wrapper around the injected generate() call) is
// exercised end-to-end by ticket-classification.test.ts's walking-skeleton scenario — no
// additional unit test is needed for that wiring per "no code without a requiring test".

describe("parseClassificationResponse", () => {
  it("parses a valid classification response for each result in the enum", () => {
    const results: ClassificationResult[] = [
      "DEVELOPMENT_WORK",
      "NOT_DEVELOPMENT_WORK",
      "LOW_CONFIDENCE",
    ];

    for (const result of results) {
      const rawText = JSON.stringify({ result, rationale: "A clear rationale." });

      const decision = parseClassificationResponse(rawText);

      expect(decision).toEqual({ result, rationale: "A clear rationale." });
    }
  });

  it("throws when the response is not valid JSON", () => {
    expect(() => parseClassificationResponse("I think this is probably a bug?")).toThrow(
      /not valid JSON/,
    );
  });

  it("throws when the result is outside the valid enum", () => {
    const rawText = JSON.stringify({ result: "MAYBE_WORK", rationale: "A rationale." });

    expect(() => parseClassificationResponse(rawText)).toThrow(/out-of-enum result/);
  });

  it("throws when the rationale is missing or blank", () => {
    const missingRationale = JSON.stringify({ result: "DEVELOPMENT_WORK" });
    const blankRationale = JSON.stringify({ result: "DEVELOPMENT_WORK", rationale: "   " });

    expect(() => parseClassificationResponse(missingRationale)).toThrow(/no rationale/);
    expect(() => parseClassificationResponse(blankRationale)).toThrow(/no rationale/);
  });
});

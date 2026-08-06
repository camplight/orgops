import { describe, expect, it } from "vitest";
import { computeIsLowDetail } from "./tickets";

describe("computeIsLowDetail", () => {
  it("flags a ticket as low-detail when no description is present", () => {
    expect(computeIsLowDetail(null)).toBe(true);
  });

  it("does not flag a ticket with a description as low-detail", () => {
    expect(computeIsLowDetail("Clicking Export to CSV throws a 500 in Safari")).toBe(false);
  });
});

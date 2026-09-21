import { describe, expect, it } from "vitest";
import { createStartReadinessOwner } from "./start-readiness-owner";

describe("post-create start-readiness ownership", () => {
  it("aborts and invalidates an older concurrent request so only the newest response is owned", () => {
    const owner = createStartReadinessOwner();
    const older = owner.begin("principal-a", "agent-id");
    const newer = owner.begin("principal-a", "agent-id");
    expect(older.signal.aborted).toBe(true);
    expect(older.isCurrent()).toBe(false);
    expect(newer.signal.aborted).toBe(false);
    expect(newer.isCurrent()).toBe(true);
  });

  it("invalidates requests when the principal, receipt, or flow lifetime changes", () => {
    const owner = createStartReadinessOwner();
    const principalRequest = owner.begin("principal-a", "agent-a");
    owner.invalidate();
    expect(principalRequest.signal.aborted).toBe(true);
    const receiptRequest = owner.begin("principal-a", "agent-a");
    const replacement = owner.begin("principal-a", "agent-b");
    expect(receiptRequest.isCurrent()).toBe(false);
    expect(replacement.isCurrent()).toBe(true);
    owner.invalidate();
    expect(replacement.signal.aborted).toBe(true);
  });
});

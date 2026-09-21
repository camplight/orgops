import { describe, expect, it } from "vitest";
import { SkillDeploymentEventSchema, SkillPreflightResultSchema, SkillSelectionSchema } from "@orgops/schemas";

describe("review-locked skill contracts", () => {
  it("accepts exact preflight selections and rejects relaxed history DTOs", () => {
    expect(SkillSelectionSchema.parse({ kind: "LOCAL", name: "tool", preload: true })).toEqual({ kind: "LOCAL", name: "tool", preload: true });
    expect(SkillPreflightResultSchema.parse({ ok: true, exactSkillRefs: [], creationBlockers: [], startBlockers: [] })).toEqual({ ok: true, exactSkillRefs: [], creationBlockers: [], startBlockers: [] });
    expect(SkillDeploymentEventSchema.safeParse({ eventId: "event-1", operation: "ADD", state: "STABLE", desiredGeneration: null, effectiveGeneration: null, failureCode: null, revision: 5, createdAt: 10 }).success).toBe(false);
    expect(SkillDeploymentEventSchema.safeParse({ eventId: "event-1", operation: "OTHER", state: "STABLE", desiredGeneration: "g", effectiveGeneration: null, failureCode: null, revision: 5, createdAt: 10 }).success).toBe(false);
    expect(SkillDeploymentEventSchema.safeParse({ eventId: "event-1", operation: "LOCAL_BATCH", state: "STABLE", desiredGeneration: "g", effectiveGeneration: null, failureCode: null, revision: 5, createdAt: 10 }).success).toBe(false);
    expect(SkillDeploymentEventSchema.safeParse({ eventId: "event-1", operation: "ADD", state: "FAILED", desiredGeneration: "g", effectiveGeneration: null, failureCode: "ARBITRARY", revision: 5, createdAt: 10 }).success).toBe(false);
    expect(SkillDeploymentEventSchema.safeParse({ eventId: "event-1", operation: "ADD", state: "FAILED", desiredGeneration: "g", effectiveGeneration: null, failureCode: "STORAGE_FAILURE", revision: 5, createdAt: 10, extra: true }).success).toBe(false);
  });
});

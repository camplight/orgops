import { describe, expect, it } from "vitest";
import { createUnifiedSkillApi } from "./api";

const digest = `sha256:${"a".repeat(64)}`;
const catalogRef = { kind: "CATALOG" as const, packageReleaseId: "release", name: "safe", version: "1.0.0", digest };
const item = { ref: catalogRef, description: "Safe", readiness: { state: "READY" as const }, provenance: "BOUNDED_HUMAN" as const };
function response(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }

describe("Unified Skills API", () => {
  it("decodes a bounded-human item and rejects admin provenance", async () => {
    const api = createUnifiedSkillApi(async () => response({ items: [{ ...item, adminProvenance: { authoritySourceId: "leak" } }] }));
    await expect(api.list({ origin: "ALL", availability: "ALL" })).resolves.toMatchObject({ ok: false, error: { code: "PROTOCOL" } });
  });

  it("rejects a bounded item carrying a local filesystem path", async () => {
    const api = createUnifiedSkillApi(async () => response({ items: [{ ...item, path: "/private/skill" }] }));
    await expect(api.list({ origin: "ALL", availability: "ALL" })).resolves.toMatchObject({ ok: false, error: { code: "PROTOCOL" } });
  });

  it("dispatches agent URL context through the filtered canonical inventory route", async () => {
    let url = "";
    const fetchFixture = async (input: RequestInfo | URL) => { url = String(input); return response({ items: [], agentRevision: 7 }); };
    const api = createUnifiedSkillApi(fetchFixture);
    const result = await api.listForAgent("agent-a", { query: "safe", origin: "LOCAL", availability: "AVAILABLE" });
    expect(url).toContain("/api/skills/inventory?agentId=agent-a&q=safe&origin=LOCAL&availability=AVAILABLE");
    expect(result).toMatchObject({ value: { agentRevision: 7 } });
  });

  it("sends exact revision-checked commands to the canonical patch route", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const api = createUnifiedSkillApi(async (input, init) => { requestUrl = String(input); requestInit = init; return response({ ref: { kind: "CATALOG", packageReleaseId: "release" }, desired: "ENABLED", effective: "DISABLED", preload: false, deployment: "REQUESTED", revision: 4, agentRevision: 9 }); });
    const result = await api.execute({ kind: "CATALOG", operation: "ASSIGN", agentId: "agent-1", packageReleaseId: "release", preload: false, expectedAgentRevision: 8, expectedAssignmentRevision: 3 });
    expect(requestUrl).toContain("/api/agents/agent-1/skills");
    expect(requestInit).toMatchObject({ method: "PATCH", credentials: "include", cache: "no-store", headers: { "content-type": "application/json" } });
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({ agentId: "agent-1", expectedAgentRevision: 8, expectedAssignmentRevision: 3 });
    expect(result).toMatchObject({ ok: true, value: { desired: "ENABLED", effective: "DISABLED" } });
  });

  it("decodes bounded assignment history from the canonical route", async () => {
    let requestUrl = "";
    const api = createUnifiedSkillApi(async input => { requestUrl = String(input); return response({ events: [{ eventId: "event-1", operation: "ASSIGN", state: "FAILED", desiredGeneration: "generation-1", effectiveGeneration: "generation-0", failureCode: "STORAGE_FAILURE", revision: 4, createdAt: 10 }] }); });
    const result = await api.history("agent-1", { kind: "CATALOG", packageReleaseId: "release" });
    expect(requestUrl).toContain("/api/agents/agent-1/skills/history?kind=CATALOG&packageReleaseId=release");
    expect(result).toMatchObject({ ok: true, value: [{ eventId: "event-1", state: "FAILED" }] });
  });

  it("forwards abort signals for history requests", async () => {
    let receivedSignal: AbortSignal | null | undefined;
    const api = createUnifiedSkillApi(async (_input, init) => { receivedSignal = init?.signal; return response({ events: [] }); });
    const controller = new AbortController();
    await api.history("agent-1", { kind: "LOCAL", name: "safe", localOrigin: "BUILT_IN" }, controller.signal);
    expect(receivedSignal).toBe(controller.signal);
  });

  it("uses credentials, no-store, and fixed error codes", async () => {
    let init: RequestInit | undefined;
    const api = createUnifiedSkillApi(async (_input, requestInit) => { init = requestInit; return response({ error: "FORBIDDEN", secret: "must-not-leak" }, 403); });
    await expect(api.list({ origin: "ALL", availability: "ALL" })).resolves.toEqual({ ok: false, error: { code: "FORBIDDEN", message: "Administrator access is required." } });
    expect(init).toMatchObject({ credentials: "include", cache: "no-store" });
  });
});

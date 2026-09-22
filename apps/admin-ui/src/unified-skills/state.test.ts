import { beforeEach, describe, expect, it } from "vitest";
import { createUnifiedSkillController } from "./state";

let popstate: (() => void) | undefined;
function setUrl(value: string) {
  const url = new URL(value);
  popstate = undefined;
  (globalThis as { window?: unknown }).window = { location: { href: url.href }, addEventListener: (_type: string, listener: () => void) => { popstate = listener; }, removeEventListener: (_type: string, listener: () => void) => { if (popstate === listener) popstate = undefined; }, history: { replaceState: (_a: unknown, _b: string, next: string) => { (globalThis as { window: { location: { href: string } } }).window.location.href = new URL(next, url).href; }, pushState: (_a: unknown, _b: string, next: string) => { (globalThis as { window: { location: { href: string } } }).window.location.href = new URL(next, url).href; } } };
}
const windowHref = () => (globalThis as { window: { location: { href: string } } }).window.location.href;

beforeEach(() => setUrl("https://example.test/?screen=dashboard"));

describe("Unified Skills controller", () => {
  it("keeps URL selection and clears unauthorized selection", () => {
    setUrl("https://example.test/?screen=skills&skillKind=CATALOG&packageReleaseId=release-skill&agentId=agent-a");
    const controller = createUnifiedSkillController({ api: { list: async () => ({ ok: true, value: { items: [] } }), listForAgent: async () => ({ ok: true, value: { items: [], agentRevision: 1 } }) } });
    expect(controller.snapshot().selection).toEqual({ skill: { kind: "CATALOG", packageReleaseId: "release-skill" }, agentId: "agent-a" });
    controller.applyUnauthorizedSelection();
    expect(new URL(windowHref()).search).toBe("?screen=skills");
  });

  it("clears FULL_ADMIN data immediately when the same human is demoted", async () => {
    const adminItem = { ref: { kind: "LOCAL" as const, name: "admin-only", localOrigin: "BUILT_IN" as const }, description: "Admin provenance", readiness: { state: "READY" as const }, provenance: "FULL_ADMIN" as const, adminProvenance: { kind: "LOCAL" as const } };
    const controller = createUnifiedSkillController({ api: { list: async () => ({ ok: true as const, value: { items: [adminItem] } }), listForAgent: async () => ({ ok: true as const, value: { items: [adminItem], agentRevision: 1 } }) } });
    controller.setPrincipal("human-a:admin=1:password=0:authenticated=1");
    await controller.load({});
    expect(controller.snapshot().items[0]?.provenance).toBe("FULL_ADMIN");
    controller.setPrincipal("human-a:admin=0:password=0:authenticated=1");
    expect(controller.snapshot().items).toEqual([]);
    expect(controller.snapshot().selectedItem).toBeNull();
  });

  it("aborts and clears prior principal data when the principal changes", () => {
    const controller = createUnifiedSkillController({ api: { list: async () => ({ ok: true, value: { items: [] } }), listForAgent: async () => ({ ok: true, value: { items: [], agentRevision: 1 } }) } });
    controller.setPrincipal("human-a");
    controller.setPrincipal("human-b");
    expect(controller.snapshot().items).toEqual([]);
    expect(controller.snapshot().selection).toEqual({ skill: null, agentId: null });
  });

  it("updates selected detail for each successive selection", async () => {
    const localA = { ref: { kind: "LOCAL" as const, name: "a", localOrigin: "BUILT_IN" as const }, description: "A", readiness: { state: "READY" as const }, provenance: "BOUNDED_HUMAN" as const };
    const localB = { ref: { kind: "LOCAL" as const, name: "b", localOrigin: "WORKSPACE" as const }, description: "B", readiness: { state: "READY" as const }, provenance: "BOUNDED_HUMAN" as const };
    const controller = createUnifiedSkillController({ api: { list: async () => ({ ok: true, value: { items: [localA, localB] } }), listForAgent: async () => ({ ok: true, value: { items: [localA, localB], agentRevision: 1 } }) } });
    await controller.load({ origin: "ALL", availability: "ALL" });
    controller.select(localA.ref); expect(controller.snapshot().selectedItem?.ref).toEqual(localA.ref);
    controller.select(localB.ref); expect(controller.snapshot().selectedItem?.ref).toEqual(localB.ref);
  });

  it("syncs selection on popstate while preserving unrelated query keys", () => {
    setUrl("https://example.test/?screen=skills&tab=history&skillKind=LOCAL&name=a&localOrigin=BUILT_IN");
    const controller = createUnifiedSkillController({ api: { list: async () => ({ ok: true, value: { items: [] } }), listForAgent: async () => ({ ok: true, value: { items: [], agentRevision: 1 } }) } });
    controller.subscribe(() => {});
    (globalThis as { window: { location: { href: string } } }).window.location.href = "https://example.test/?screen=skills&tab=history&skillKind=LOCAL&name=b&localOrigin=WORKSPACE";
    popstate?.();
    expect(controller.snapshot().selection.skill).toEqual({ kind: "LOCAL", name: "b", localOrigin: "WORKSPACE" });
    expect(new URL(windowHref()).searchParams.get("tab")).toBe("history");
    controller.dispose(); expect(popstate).toBeUndefined();
  });

  it("aborts stale agent requests and loads the new context", async () => {
    setUrl("https://example.test/?screen=skills&agentId=agent-a");
    let resolveA: ((value: any) => void) | undefined;
    let resolveB: ((value: any) => void) | undefined;
    const a = { ref: { kind: "LOCAL" as const, name: "a", localOrigin: "BUILT_IN" as const }, description: "A", readiness: { state: "READY" as const }, provenance: "BOUNDED_HUMAN" as const };
    const b = { ref: { kind: "LOCAL" as const, name: "b", localOrigin: "WORKSPACE" as const }, description: "B", readiness: { state: "READY" as const }, provenance: "BOUNDED_HUMAN" as const };
    const controller = createUnifiedSkillController({ api: { list: async () => ({ ok: true, value: { items: [] } }), listForAgent: async (agentId: string) => new Promise(resolve => { if (agentId === "agent-a") resolveA = resolve; else resolveB = resolve; }) as any } });
    const first = controller.load({ origin: "ALL", availability: "ALL" });
    const second = controller.setAgentId("agent-b");
    resolveA?.({ ok: true, value: { items: [a], agentRevision: 1 } });
    resolveB?.({ ok: true, value: { items: [b], agentRevision: 2 } });
    await Promise.all([first, second]);
    expect(controller.snapshot().selection.agentId).toBe("agent-b");
    expect(controller.snapshot().items).toEqual([b]);
    expect(controller.snapshot().agentRevision).toBe(2);
  });

  it("uses agent context and retains agent revision", async () => {
    setUrl("https://example.test/?screen=skills&agentId=agent-a");
    const controller = createUnifiedSkillController({ api: { list: async () => ({ ok: true, value: { items: [] } }), listForAgent: async () => ({ ok: true, value: { items: [], agentRevision: 7 } }) } });
    await controller.load({ origin: "ALL", availability: "ALL" });
    expect(controller.snapshot().agentRevision).toBe(7);
  });
});

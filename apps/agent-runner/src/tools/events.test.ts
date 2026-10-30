import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { execute } from "./events";
import type { ExecuteContext } from "./types";

function createContext(workspacePath: string, apiFetch: ExecuteContext["apiFetch"]): ExecuteContext {
  return {
    agent: { name: "PayloadAgent", workspacePath } as any,
    triggerEvent: { id: "trigger" } as any,
    injectionEnv: {},
    apiFetch,
    emitEvent: vi.fn(),
    emitAudit: vi.fn(),
  };
}

describe("events_payload_read", () => {
  it("returns a bounded payload chunk", async () => {
    const apiFetch = vi.fn(async (path: string) => {
      expect(path).toBe("/api/events/event-1/payload?offset=2&limit=4");
      return new Response(
        JSON.stringify({
          eventId: "event-1",
          storage: "db",
          totalChars: 10,
          offset: 2,
          limit: 4,
          chunk: "cdef",
          nextOffset: 6,
          done: false,
        }),
      );
    });
    const ctx = createContext(mkdtempSync(join(tmpdir(), "orgops-agent-")), apiFetch);
    try {
      const result = await execute(ctx, "events_payload_read", {
        eventId: "event-1",
        offset: 2,
        limit: 4,
      });
      expect(result).toMatchObject({
        eventId: "event-1",
        storage: "db",
        chunk: "cdef",
        nextOffset: 6,
        done: false,
      });
    } finally {
      rmSync(ctx.agent.workspacePath, { recursive: true, force: true });
    }
  });

  it("pages a payload into a workspace file", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "orgops-agent-")));
    const payload = "abcdefghijklmnopqrstuvwxyz";
    const apiFetch = vi.fn(async (path: string) => {
      const url = new URL(`http://localhost${path}`);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 8);
      const chunk = payload.slice(offset, offset + limit);
      return new Response(
        JSON.stringify({
          eventId: "event-2",
          storage: "file",
          totalChars: payload.length,
          byteLength: payload.length,
          offset,
          limit,
          chunk,
          nextOffset: offset + chunk.length,
          done: offset + chunk.length >= payload.length,
          sha256: "abc123",
        }),
      );
    });
    const ctx = createContext(workspace, apiFetch);
    try {
      const result = await execute(ctx, "events_payload_read", {
        eventId: "event-2",
        limit: 8,
        saveToWorkspacePath: "payloads/event-2.json",
      });
      expect(result).toMatchObject({
        ok: true,
        eventId: "event-2",
        storage: "file",
        totalChars: payload.length,
        writtenBytes: payload.length,
        complete: true,
        sha256: "abc123",
      });
      expect(readFileSync(join(workspace, "payloads/event-2.json"), "utf8")).toBe(payload);
      expect(apiFetch).toHaveBeenCalledTimes(4);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

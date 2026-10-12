import { describe, it, expect, vi } from "vitest";
import { execute } from "./composio";
import type { ExecuteContext } from "./types";
describe("Composio runner adapter", () => {
  it("binds execution to the actual turn and refuses identity overrides", async () => {
    const apiFetch = vi.fn(async () => Response.json({ successful: true }));
    const context = {
      agent: { name: "PuffOwner" },
      triggerEvent: { id: "owner-message" },
      apiFetch,
    } as unknown as ExecuteContext;
    const args = {
      connectionId: "ca_owner",
      tool: "TRELLO_LIST_BOARDS",
      arguments: {},
    };
    expect(
      await execute(context, "composio_execute", {
        ...args,
        agentName: "OtherAgent",
      }),
    ).toEqual({ error: "Invalid Composio tool arguments" });
    expect(apiFetch).not.toHaveBeenCalled();
    expect(await execute(context, "composio_execute", args)).toEqual({
      successful: true,
    });
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/composio/runner/execute",
      expect.objectContaining({
        body: JSON.stringify({
          ...args,
          agentName: "PuffOwner",
          triggerEventId: "owner-message",
        }),
      }),
    );
  });
  it("does not surface rejected API response bodies to the model", async () => {
    const context = {
      agent: { name: "PuffOwner" },
      triggerEvent: { id: "owner-message" },
      apiFetch: async () =>
        Response.json({ private: "hidden" }, { status: 403 }),
    } as unknown as ExecuteContext;
    expect(await execute(context, "composio_connections", {})).toEqual({
      error: "Composio request denied or unavailable (403)",
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunnerApi } from "./api";
import { createRunnerState } from "./state";

const originalFetch = globalThis.fetch;

function createSubject() {
  return createRunnerApi({
    apiUrl: "http://localhost:8787",
    runnerToken: "test-token",
    heartbeatIntervalMs: 5_000,
    runnerIdFile: "/tmp/orgops-runner-id-test",
    runnerState: createRunnerState(),
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("runner api secrets env", () => {
  it("returns resolved secrets env on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ CURSOR_API_KEY: "cursor-key" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const api = createSubject();
    const env = await api.getPackageSecretsEnv("Agent Name", "chan-1");

    expect(env.CURSOR_API_KEY).toBe("cursor-key");
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("x-orgops-runner-token")).toBe("test-token");
    expect(headers.get("x-orgops-agent-name")).toBe("Agent Name");
    expect(headers.get("x-orgops-channel-id")).toBe("chan-1");
  });

  it("propagates /api/secrets/env errors instead of returning empty env", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Forbidden", { status: 403 }),
    ) as unknown as typeof fetch;

    const api = createSubject();
    await expect(api.getPackageSecretsEnv("Agent Name")).rejects.toThrow(
      "API /api/secrets/env failed: 403 Forbidden",
    );
  });
});

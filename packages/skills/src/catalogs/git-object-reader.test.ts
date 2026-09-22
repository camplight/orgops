import { afterEach, expect, it, vi } from "vitest";
import { createGitFixture } from "./git-fixtures";
import * as sessions from "./git-session";
import { withGitObjectReader } from "./git-object-reader";

vi.mock("./git-session", async original => ({ ...await original<typeof import("./git-session")>() }));
afterEach(() => vi.restoreAllMocks());

it.each(["sha1", "sha256"] as const)("shared reader owns exact %s root and cleanup", async format => {
  const f = await createGitFixture(format);
  try {
    const bytes = Buffer.from([0xff, 0, 10]);
    const commit = await f.commit([{ path: "index.json", bytes }]);
    const result = await withGitObjectReader(
      { repository: f.repository, commit, indexPath: "index.json" },
      sessions.createGitOperation(), "indexPath", async (r, s) => {
        expect(s.path).toBe("index.json");
        const entries = await r.readTree(await r.root(s.commit), 0);
        expect(entries).toHaveLength(1);
        expect(entries[0]!.name.equals(Buffer.from("index.json"))).toBe(true);
        return (await r.contents(await r.info(entries[0]!.oid, "blob"), 3)).toString("base64");
      });
    expect(result).toEqual({ ok: true, value: "/wAK" });
  } finally { await f.dispose(); }
});

const input = { repository: { directory: "/never", gitExecutable: "/usr/bin/git" }, commit: "1".repeat(40), indexPath: "index.json" };
const bad = (code: sessions.OfflineGitIssue["code"]): sessions.OfflineGitResult<never> => ({ ok: false, issues: [{ code, at: "git" }] });

// Only lifecycle faults are doubled: actual object integrity is exercised with owned Git above.
it.each(["success", "protocol", "throw", "finish"] as const)("owns delayed cleanup after consumer %s", async which => {
  for (const cleanup of ["confirmed", "failed", "throw"] as const) {
    const controller = new AbortController();
    let release!: () => void;
    const session: sessions.GitObjectSession = {
      objectFormat: "sha1",
      info: vi.fn(async () => bad("GIT_OBJECT_MISSING")),
      contents: vi.fn(async () => bad("GIT_OBJECT_MISSING")),
      finish: vi.fn<sessions.GitObjectSession["finish"]>(async () => which === "finish" ? bad("GIT_FAILED") : { ok: true, value: true }),
      dispose: vi.fn<sessions.GitObjectSession["dispose"]>(async () => {
        await new Promise<void>(resolve => { release = resolve; });
        if (cleanup !== "confirmed") controller.abort(); // cleanup failure must outrank final cancellation
        if (cleanup === "throw") throw new Error("secret=disposal");
        return cleanup === "failed" ? bad("GIT_CLEANUP_FAILED") : { ok: true, value: true };
      }),
    };
    vi.spyOn(sessions, "openGitObjectSession").mockResolvedValue({ ok: true, value: session });
    let settled = false;
    const pending = withGitObjectReader(input, sessions.createGitOperation(controller.signal), "indexPath", async reader => {
      if (which === "protocol") reader.fail("GIT_PROTOCOL_ERROR");
      if (which === "throw") throw new Error("secret=consumer");
      return { pending: "detached data" };
    }).then(result => { settled = true; return result; });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(settled).toBe(false);
    release();
    const result = await pending;
    expect(result).toEqual(cleanup !== "confirmed" ? bad("GIT_CLEANUP_FAILED") : which === "success"
      ? { ok: true, value: { pending: "detached data" } } : bad(which === "protocol" ? "GIT_PROTOCOL_ERROR" : "GIT_FAILED"));
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(session.finish).toHaveBeenCalledTimes(which === "success" || which === "finish" ? 1 : 0);
  }
});

it("rejects pre-abort and invalid envelopes without opening a session or invoking the consumer", async () => {
  const open = vi.spyOn(sessions, "openGitObjectSession"), consumer = vi.fn(async () => true);
  const controller = new AbortController(); controller.abort();
  expect(await withGitObjectReader(input, sessions.createGitOperation(controller.signal), "indexPath", consumer)).toEqual(bad("GIT_ABORTED"));
  expect(await withGitObjectReader({ ...input, extra: true }, sessions.createGitOperation(), "indexPath", consumer))
    .toEqual({ ok: false, issues: [{ code: "INVALID_GIT_INPUT", at: "$" }] });
  expect(open).not.toHaveBeenCalled(); expect(consumer).not.toHaveBeenCalled();
});

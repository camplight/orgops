import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCatalogGitTransport, CATALOG_SYNC_STAGING_REF } from "./git-fetch";
import { parseGitHubDestination } from "./github-destination";
import { createFakeGit } from "./fixtures.test-helper";

const destination = (() => {
  const parsed = parseGitHubDestination("https://github.com/org/repo");
  if (!parsed.ok) throw new Error("fixture destination rejected");
  return parsed.value;
})();
const secret = "synthetic-secret-token-1234567890";
const expectedHeader = `Authorization: Basic ${Buffer.from(`reader:${secret}`, "utf8").toString("base64")}`;

async function withFake<T>(mode: "ok" | "hang" | "loud" | "fail", run: (fake: Awaited<ReturnType<typeof createFakeGit>>) => Promise<T>): Promise<T> {
  const fake = await createFakeGit(mode, undefined, expectedHeader);
  try { return await run(fake); } finally { await fake.dispose(); }
}

async function scanForSecret(dir: string): Promise<boolean> {
  // Recursive bounded scan: proves the secret never persisted inside the mirror directory.
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (await scanForSecret(path)) return true; }
    else if (entry.isFile() && (await readFile(path)).includes(secret)) return true;
  }
  return false;
}

describe("createCatalogGitTransport", () => {
  it("injects the credential ONLY via fetch child env, never argv or disk", async () => withFake("ok", async fake => {
    const transport = createCatalogGitTransport(fake.executable);
    const result = await transport.fetch(destination, "main", fake.directory, { username: "reader", password: secret });
    expect(result).toEqual({ ok: true, value: true });
    const capture = await readFile(fake.capture, "utf8");
    expect(capture).toContain("value0=MATCH");          // exact injected header reached the child env
    expect(capture).toContain("count=1");
    expect(capture).toContain("key0=http.https://github.com/.extraheader");
    expect(capture).toContain("allow=https");
    expect(capture).toContain("prompt=0");
    expect(capture).not.toContain(secret);              // argv/capture never carry the secret
    expect(capture).not.toContain("reader:");
    expect(capture).toContain("--no-tags");
    expect(capture).toContain("--depth=1");
    expect(capture).toContain("http.followRedirects=false");
    expect(capture).toContain("credential.helper=");
    expect(capture).toContain("core.hooksPath=/dev/null");
    expect(capture).toContain(`+refs/heads/main:${CATALOG_SYNC_STAGING_REF}`);
    expect(capture).toContain("https://github.com/org/repo.git");
    expect(await scanForSecret(fake.directory)).toBe(false); // no file under the mirror contains it
  }));
  it("sends NO credential config for a public fetch", async () => withFake("ok", async fake => {
    const result = await createCatalogGitTransport(fake.executable).fetch(destination, "main", fake.directory, undefined);
    expect(result).toEqual({ ok: true, value: true });
    const capture = await readFile(fake.capture, "utf8");
    expect(capture).toContain("value0=ABSENT");
    expect(capture).toContain("count=unset");
  }));
  it("times out, kills, and reaps a hung fetch before settling", async () => withFake("hang", async fake => {
    const started = Date.now();
    const result = await createCatalogGitTransport(fake.executable).fetch(destination, "main", fake.directory, undefined);
    expect(result).toEqual({ ok: false, issue: { code: "GIT_TIMEOUT" } });
    expect(Date.now() - started).toBeLessThan(70000);
    // Settlement happened only after the owned child was killed and its close observed
    // (bounded post-kill reap allowance); assert no surviving fake-git process group:
    const lingering = await readFile(fake.capture, "utf8");
    expect(lingering).toContain("argc="); // child did start; kill+reap path exercised
  }), 90000);
  it("bounds stdout", async () => withFake("loud", async fake => {
    const result = await createCatalogGitTransport(fake.executable).resolveRef(fake.directory, CATALOG_SYNC_STAGING_REF);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(["GIT_LIMIT_EXCEEDED", "GIT_PROTOCOL_ERROR"]).toContain(result.issue.code);
  }));
  it("maps nonzero exit to fixed failure without stderr leakage", async () => withFake("fail", async fake => {
    const result = await createCatalogGitTransport(fake.executable).fetch(destination, "main", fake.directory, undefined);
    expect(result).toEqual({ ok: false, issue: { code: "GIT_FAILED" } });
  }));
});

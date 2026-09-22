import { createServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { SourceView } from "./api";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const digest = `sha256:${"b".repeat(64)}`;
const snapshot = { snapshotId: "snapshot-1", sourceId: "source-team", sourceCommit: "c".repeat(40), indexDigest: digest, observedRef: "main", createdAt: 1 };
const source = { sourceId: "source-team", displayName: "Team Source", canonicalUrl: "https://example.test/team.git", repositoryIdentity: "https://example.test/team.git", ref: "main", enabled: true, allowPackages: true, revision: 3, removedAt: null, currentSnapshotId: snapshot.snapshotId, hasReadCredential: false } satisfies SourceView;
const sourceB = { ...source, sourceId: "source-other", displayName: "Other Source", canonicalUrl: "https://example.test/other.git", currentSnapshotId: "snapshot-other" } satisfies SourceView;
const grant = { grantId: "grant-1", releaseId: "release-skill", subject: { kind: "ORGANIZATION" as const }, revision: 1, revokedAt: null };
const release = { packageReleaseId: "release-skill", authoritySourceId: "source-team", contentSourceId: "source-team", kind: "skill", name: "safe", version: "1.2.3", digest, catalogCommit: "a".repeat(40), packageCommit: "b".repeat(40), packagePath: "skills/demo", manifest: { formatVersion: 1, kind: "skill", name: "safe", version: "1.2.3", digest, description: "safe <script>window.__xss=1</script>", author: "human-a", license: "MIT", compatibility: { orgops: { min: "1.0.0" }, platforms: ["linux"], tools: ["shell"] }, dependencies: [], secrets: [], files: [{ path: "SKILL.md", size: 10, digest, executable: false }], executables: [], skill: { entrypoint: "SKILL.md" } }, executionPreview: { apiEventShapes: ["event-shapes.ts"], runnerScripts: ["runner.ts"], wrappedCommands: [], externalSources: [] }, warnings: [{ code: "SENSITIVE_TEXT", at: "runner.ts" }], files: [{ path: "SKILL.md", mode: 0o644, size: 10, digest }], reviewState: "PENDING", reviewDigest: null, reviewer: null, installationState: "ABSENT", apiActivation: { approvalState: "AWAITING_APPROVAL", runtimeState: "INACTIVE", revision: 1, failureCode: null }, revision: 1 };

let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
let credentialRequest: Promise<void> | undefined;
let resolveCredential: (() => void) | undefined;
const calls: string[] = [];
const releaseB = { ...release, packageReleaseId: "release-other", authoritySourceId: "source-other", contentSourceId: "source-other", name: "other" };
const snapshotB = { ...snapshot, snapshotId: "snapshot-other", sourceId: "source-other" };
let sourceState: SourceView = source;
let rolloutConfirmCount = 0;
let syncFailed = false;
let createSyncFailed = true;
let appUrl = "";
let sourceDetailGate: Promise<void> | null = null;
let releaseSourceDetail: (() => void) | null = null;

function executablePath() {
  const candidates = [process.env.ORGOPS_BROWSER_EXECUTABLE, "/usr/bin/google-chrome", "/opt/google/chrome/google-chrome"].filter((value): value is string => Boolean(value));
  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) throw new Error(`Chrome executable not found; checked ${candidates.join(", ")}`);
  return found;
}
function json(route: import("playwright-core").Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

beforeAll(async () => {
  server = await createServer({ root, configFile: false, plugins: [react()], server: { host: "127.0.0.1", port: 0, hmr: false, proxy: {} } });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite did not expose a local URL");
  browser = await chromium.launch({ executablePath: executablePath(), headless: true, args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  credentialRequest = new Promise<void>(resolveRequest => { resolveCredential = resolveRequest; });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === "/api/auth/me") return json(route, { id: "human-a", username: "admin", isAdmin: true, mustChangePassword: false });
    if (path === "/api/catalog-sources" && method === "GET") return json(route, { sources: [sourceState, sourceB] });
    if (path === "/api/catalog-sources/source-team" && method === "GET") { if (sourceDetailGate) await sourceDetailGate; return json(route, sourceState); }
    if (path === "/api/catalog-sources/source-other" && method === "GET") return json(route, sourceB);
    if (path.endsWith("/sync-attempts")) { const isOther = path.includes("source-other"); return json(route, { attempts: [{ attemptId: isOther ? "attempt-other" : "attempt-1", sourceId: isOther ? sourceB.sourceId : source.sourceId, state: "SUCCEEDED", snapshotId: isOther ? snapshotB.snapshotId : snapshot.snapshotId, failureCode: null, revision: 3 }] }); }
    if (path.endsWith("/snapshots")) return json(route, { snapshots: [path.includes("source-other") ? snapshotB : snapshot] });
    if (path === "/api/catalog-releases" && method === "GET") return json(route, { releases: [release, releaseB] });
    if (path === "/api/catalog-releases/release-skill" && method === "GET") return json(route, release);
    if (path === "/api/catalog-releases/release-other" && method === "GET") return json(route, releaseB);
    if (path.endsWith("/grants")) return json(route, { grants: [] });
    if (path === "/api/humans") return json(route, [{ id: "human-b", username: "reviewer", displayName: "Reviewer" }]);
    if (path === "/api/events/stats") return json(route, { total: 0, byStatus: {} });
    if (path === "/api/event-types") return json(route, { eventTypes: [] });
    if (path.startsWith("/api/events")) return json(route, []);
    if (["/api/agents", "/api/runners", "/api/skills", "/api/teams", "/api/channels", "/api/processes", "/api/secrets", "/api/integration-keys", "/api/agent-invites"].includes(path)) return json(route, []);
    if (method !== "GET" && path.includes("/read-credential") && method === "PUT") {
      await credentialRequest;
      sourceState = { ...sourceState, hasReadCredential: true, revision: sourceState.revision + 1 };
      return json(route, { kind: "source", source: sourceState });
    }
    if (method !== "GET") {
      const body = request.postDataJSON() as unknown;
      calls.push(`${method} ${path}`);
      if (path.endsWith("/api-execution/approve")) return json(route, { ...release.apiActivation, releaseId: release.packageReleaseId, approvalState: "APPROVED", revision: 2 });
      if (path.endsWith("/approve") || path.endsWith("/reject") || path.endsWith("/withdraw") || path.endsWith("/reopen")) return json(route, { kind: "review", release: { ...release, reviewState: "APPROVED", revision: 2, reviewDigest: digest, reviewer: { humanId: "human-a", reviewedAt: 2 } } });
      if (path.endsWith("/api-execution/activate")) return json(route, { ...release.apiActivation, releaseId: release.packageReleaseId, approvalState: "APPROVED", runtimeState: "ACTIVE", revision: 3 });
      if (path.endsWith("/api-execution/deactivate")) return json(route, { ...release.apiActivation, releaseId: release.packageReleaseId, approvalState: "APPROVED", runtimeState: "INACTIVE", revision: 4 });
      if (path === "/api/catalog-rollouts/plan") return json(route, { planDigest: digest, releaseId: release.packageReleaseId, operation: body && typeof body === "object" && "operation" in body ? (body as { operation: string }).operation : "ENABLE", preload: body && typeof body === "object" && "preload" in body ? (body as { preload: boolean }).preload : undefined, targets: [{ agentId: "agent-a", assignmentRevision: 1, runnerId: "runner-a", plannedPreload: body && typeof body === "object" && "preload" in body ? (body as { preload: boolean }).preload : false, blocker: null }] });
      if (path === "/api/catalog-rollouts") { rolloutConfirmCount += 1; return json(route, { id: "rollout-1", releaseId: release.packageReleaseId, operation: "SET_PRELOAD", preload: true, state: rolloutConfirmCount === 1 ? "QUEUED" : "PARTIAL", revision: 1, targetIds: ["agent-a"], targets: [{ agentId: "agent-a", state: rolloutConfirmCount === 1 ? "QUEUED" : "FAILED", attempts: rolloutConfirmCount === 1 ? 0 : 1, reasonCode: rolloutConfirmCount === 1 ? null : "DEPLOYMENT_REQUIRED" }] }); }
      if (path.endsWith("/cancel")) return json(route, { rollout: { id: "rollout-1", releaseId: release.packageReleaseId, operation: "SET_PRELOAD", preload: true, state: "CANCELLED", revision: 2, targetIds: ["agent-a"], targets: [{ agentId: "agent-a", state: "SKIPPED", attempts: 0, reasonCode: null }] }, skippedTargetIds: ["agent-a"] });
      if (path.endsWith("/retry-failed")) return json(route, { rollout: { id: "rollout-1", releaseId: release.packageReleaseId, operation: "SET_PRELOAD", preload: true, state: "RUNNING", revision: 3, targetIds: ["agent-a"], targets: [{ agentId: "agent-a", state: "QUEUED", attempts: 1, reasonCode: null }] }, targetIds: ["agent-a"], deploymentIds: ["deployment-1"] });
      if (path.includes("/grants/")) return json(route, { kind: "grant", grant: { ...grant, subject: path.includes("/humans/") ? { kind: "HUMAN", humanId: "human-b" } : grant.subject } });
      if (path === "/api/catalog-sources" && method === "POST") return json(route, { kind: "source", source: { ...source, sourceId: "new-source", displayName: "New Source", revision: 1 }, syncAttempt: createSyncFailed ? { attemptId: "attempt-new-failed", sourceId: "new-source", state: "FAILED", snapshotId: null, failureCode: "SOURCE_UNAVAILABLE", revision: 1 } : { attemptId: "attempt-new", sourceId: "new-source", state: "SUCCEEDED", snapshotId: snapshot.snapshotId, failureCode: null, revision: 2 } });
      if (path.endsWith("/sync")) { const syncSourceId = path.split("/")[3] ?? source.sourceId; const syncSource = syncSourceId === "new-source" ? { ...sourceState, sourceId: "new-source", displayName: "New Source" } : sourceState; return json(route, { kind: "sync", source: syncSource, syncAttempt: syncFailed || createSyncFailed ? { attemptId: syncSourceId === "new-source" ? "attempt-new-failed" : "attempt-failed", sourceId: syncSourceId, state: "FAILED", snapshotId: null, failureCode: "SOURCE_UNAVAILABLE", revision: syncSource.revision + 1 } : { attemptId: "attempt-1", sourceId: syncSourceId, state: "SUCCEEDED", snapshotId: snapshot.snapshotId, failureCode: null, revision: syncSource.revision + 1 } }); }
      if (method === "DELETE" && path === "/api/catalog-sources/source-team") sourceState = { ...sourceState, removedAt: 10, enabled: false, allowPackages: false, revision: sourceState.revision + 1 };
      if (path.endsWith("/restore")) sourceState = { ...sourceState, removedAt: null, enabled: false, allowPackages: false, revision: sourceState.revision + 1 };
      if (method === "PATCH") sourceState = { ...sourceState, revision: sourceState.revision + 1 };
      return json(route, { kind: "source", source: sourceState });
    }
    return json(route, {});
  });
  appUrl = url;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    (window as Window & { __credentialFetchValues?: { username: string; password: string }[] }).__credentialFetchValues = [];
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/read-credential") && init?.method === "PUT") {
        (window as Window & { __credentialFetchValues?: { username: string; password: string }[] }).__credentialFetchValues?.push({ username: document.querySelector<HTMLInputElement>("#source-library-username")?.value ?? "", password: document.querySelector<HTMLInputElement>("#source-library-password")?.value ?? "" });
      }
      return original(input, init);
    }) as typeof window.fetch;
  });
  await page.getByRole("button", { name: "Source Library" }).click({ force: true });
  await page.getByRole("heading", { name: "Source Library", exact: true }).waitFor({ state: "visible" });
}, 30000);

afterAll(async () => {
  resolveCredential?.();
  await page?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
});

describe("Source Library real Chrome journeys", () => {
  it("drives source, release, API, grant, and rollout controls at 390px", async () => {
    if (!page) throw new Error("browser page was not created");
    await page.waitForTimeout(1000);
    await page.evaluate(() => { (window as Window & { __busyTransitions?: boolean[] }).__busyTransitions = []; const root = document.querySelector("[aria-busy]"); if (root) new MutationObserver(() => { const value = root.getAttribute("aria-busy") === "true"; (window as Window & { __busyTransitions?: boolean[] }).__busyTransitions?.push(value); }).observe(root, { attributes: true, attributeFilter: ["aria-busy"] }); });
    const documentMetrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth, focusable: document.querySelectorAll("button,input,select,textarea,[tabindex]").length }));
    expect(documentMetrics.overflow).toBe(true);
    expect(documentMetrics.focusable).toBeGreaterThan(0);
    expect(await page.locator("#source-library-username").count()).toBe(0);
    expect(await page.getByText("Select a Source or release to inspect it.").count()).toBe(1);
    const addSourceButton = page.getByRole("button", { name: "+Add Source" });
    await addSourceButton.click();
    const initialDrawer = page.getByRole("dialog", { name: "Add Source" });
    await initialDrawer.waitFor({ state: "visible" });
    expect(await initialDrawer.locator("#source-library-username, #source-library-password").count()).toBe(0);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-labelledby="add-source-title"]'));
    expect(await page.evaluate(() => document.activeElement?.textContent)).toContain("+Add Source");
    await addSourceButton.click();
    await page.getByRole("dialog", { name: "Add Source" }).waitFor({ state: "visible" });
    await page.getByLabel("Source ID").fill("new-source");
    await page.getByLabel("Display name").last().fill("New Source");
    await page.getByLabel("Repository").fill("https://example.test/new.git");
    await page.getByLabel("Ref").fill("main");
    const createRequest = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/api/catalog-sources");
    await page.getByRole("button", { name: "Create Source" }).click();
    const created = await createRequest;
    expect(created.postDataJSON()).toEqual({ sourceId: "new-source", displayName: "New Source", repository: { url: "https://example.test/new.git" }, ref: "main", enabled: true, allowPackages: false });
    await page.getByRole("button", { name: "New Source" }).waitFor({ state: "visible" });
    expect(await page.getByRole("button", { name: "New Source" }).getAttribute("aria-pressed")).toBe("true");
    await page.getByText("Retry sync").waitFor({ state: "visible" });
    createSyncFailed = false;
    await page.getByText("Retry sync").first().click();
    await page.waitForFunction(() => document.querySelector('[aria-busy]')?.getAttribute("aria-busy") === "false");
    expect(await page.getByText("Writes are blocked after a conflict or sync failure.").count()).toBe(0);
    await page.getByRole("button", { name: "Reload Source Library" }).click();
    await page.waitForFunction(() => (window as Window & { __busyTransitions?: boolean[] }).__busyTransitions?.includes(false));
    expect(await page.evaluate(() => (window as Window & { __busyTransitions?: boolean[] }).__busyTransitions)).toEqual(expect.arrayContaining([true, false]));
    await page.getByText("safe 1.2.3").waitFor({ state: "visible" });
    const unsafeText = page.getByText("safe 1.2.3");
    expect(await unsafeText.evaluate(element => ({ scripts: element.closest("main")?.querySelectorAll("script").length ?? 0, sideEffect: (window as Window & { __xss?: unknown }).__xss }))).toEqual({ scripts: 0, sideEffect: undefined });

    await page.evaluate(() => { const url = new URL(window.location.href); url.searchParams.set("trace", "keep"); history.replaceState({}, "", url); });
    await page.getByRole("button", { name: "Team Source" }).click();
    await page.waitForFunction(() => document.querySelector('[aria-busy]')?.getAttribute("aria-busy") === "false");
    await page.getByRole("button", { name: /safe 1\.2\.3/ }).click();
    await page.waitForFunction(() => document.querySelector('[aria-busy]')?.getAttribute("aria-busy") === "false");
    await page.getByRole("tab", { name: "Activity" }).click();
    await page.getByRole("button", { name: "Other Source" }).click();
    await page.waitForFunction(() => document.querySelector('[aria-busy]')?.getAttribute("aria-busy") === "false");
    await page.getByRole("button", { name: /other 1\.2\.3/ }).click();
    await page.waitForFunction(() => document.querySelector('[aria-busy]')?.getAttribute("aria-busy") === "false");
    await page.getByRole("tab", { name: "Compatibility" }).click();
    expect(await page.evaluate(() => new URL(window.location.href).searchParams.get("trace"))).toBe("keep");
    await page.goBack(); await page.waitForFunction(() => new URL(window.location.href).searchParams.get("source") === "source-other");
    await page.goBack(); await page.waitForFunction(() => new URL(window.location.href).searchParams.get("source") === "source-other" && !new URL(window.location.href).searchParams.get("release"));
    await page.goBack(); await page.waitForFunction(() => new URL(window.location.href).searchParams.get("source") === "source-team");
    await page.waitForFunction(() => document.querySelector('[aria-busy]')?.getAttribute("aria-busy") === "false");
    expect(await page.getByRole("button", { name: "Team Source" }).getAttribute("aria-pressed")).toBe("true");
    expect(await page.getByRole("button", { name: /safe 1\.2\.3/ }).getAttribute("aria-pressed")).toBe("true");
    expect(await page.getByRole("tab", { name: "Activity" }).getAttribute("aria-selected")).toBe("true");
    expect(await page.getByText("snapshot-1").count()).toBeGreaterThan(0);
    await page.goForward(); await page.waitForFunction(() => new URL(window.location.href).searchParams.get("source") === "source-other");
    await page.goForward(); await page.waitForFunction(() => new URL(window.location.href).searchParams.get("release") === "release-other");
    await page.goForward(); await page.waitForFunction(() => new URL(window.location.href).searchParams.get("tab") === "COMPATIBILITY");
    await page.waitForFunction(() => document.querySelector('[aria-busy]')?.getAttribute("aria-busy") === "false");
    expect(await page.getByRole("button", { name: "Other Source" }).getAttribute("aria-pressed")).toBe("true");
    expect(await page.getByRole("button", { name: /other 1\.2\.3/ }).getAttribute("aria-pressed")).toBe("true");
    expect(await page.getByRole("tab", { name: "Compatibility" }).getAttribute("aria-selected")).toBe("true");
    expect(await page.evaluate(() => new URL(window.location.href).searchParams.get("trace"))).toBe("keep");

    sourceDetailGate = new Promise<void>(resolveGate => { releaseSourceDetail = resolveGate; });
    await page.getByRole("button", { name: "Team Source" }).click();
    await page.waitForFunction(() => document.querySelector('[aria-busy]')?.getAttribute("aria-busy") === "true");
    await page.getByRole("tab", { name: "Security" }).click();
    releaseSourceDetail?.(); sourceDetailGate = null; releaseSourceDetail = null;
    await page.waitForFunction(() => document.querySelector('[aria-busy]')?.getAttribute("aria-busy") === "false");
    expect(await page.getByRole("tab", { name: "Security" }).getAttribute("aria-selected")).toBe("true");
    expect(await page.getByText("Selected Source / release").count()).toBeGreaterThan(0);
    await page.getByRole("tab", { name: "Overview" }).click();
    await page.getByRole("tabpanel", { name: "Overview" }).getByText("catalog/index.json").waitFor({ state: "visible" });
    expect(await page.getByRole("button", { name: "Team Source" }).getAttribute("aria-pressed")).toBe("true");
    syncFailed = true;
    await page.getByRole("button", { name: "Sync Source" }).click();
    await page.getByText("Retry sync").waitFor({ state: "visible" });
    expect(await page.getByText("Writes are blocked after a conflict or sync failure.").count()).toBe(1);
    syncFailed = false;
    await page.getByText("Retry sync").first().click();
    await page.waitForFunction(() => document.querySelector('[aria-busy]')?.getAttribute("aria-busy") === "false");
    expect(await page.getByText("Retry sync").count()).toBe(0);
    for (const [tab, expected] of [["Overview", "Selected Source"], ["Compatibility", "Compatibility"], ["Contents", "Viewing content is read-only"], ["Security", "Source Security"], ["Activity", "Activity"]] as const) {
      await page.getByRole("tab", { name: tab }).click();
      const panelId = `source-library-panel-${tab.toLowerCase()}`;
      const panel = page.locator(`#${panelId}`);
      await panel.waitFor({ state: "visible" });
      expect(await panel.getAttribute("role")).toBe("tabpanel");
      expect(await panel.innerText()).toContain(expected);
    }
    await page.getByRole("tab", { name: "Overview" }).click();
    await page.getByLabel("Read username").fill("reader");
    await page.getByLabel("Read password or read-only token").fill("secret");
    const credentialObserved = page.waitForRequest(request => request.method() === "PUT" && request.url().includes("/read-credential"));
    await page.getByRole("button", { name: "Save read credential" }).click();
    await credentialObserved;
    expect(await page.evaluate(() => (window as Window & { __credentialFetchValues?: { username: string; password: string }[] }).__credentialFetchValues)).toEqual([{ username: "", password: "" }]);
    expect(await page.getByLabel("Read username").inputValue()).toBe("");
    expect(await page.getByLabel("Read password or read-only token").inputValue()).toBe("");
    resolveCredential?.();
    await page.waitForTimeout(100);
    await page.getByRole("button", { name: "Reload Source Library" }).click();
    await page.waitForFunction(() => document.querySelector("[aria-busy]")?.getAttribute("aria-busy") === "false");
    await page.getByRole("button", { name: "Team Source" }).click();
    await page.waitForFunction(() => document.querySelector("[aria-busy]")?.getAttribute("aria-busy") === "false");
    await page.locator("#source-display-name").fill("Renamed Source");
    const patchRequest = page.waitForRequest(request => request.method() === "PATCH" && request.url().includes("/api/catalog-sources/source-team"));
    await page.getByRole("button", { name: "Save Source" }).click();
    expect((await patchRequest).postDataJSON()).toEqual({ expectedRevision: 4, displayName: "Renamed Source" });
    const removeRequest = page.waitForRequest(request => request.method() === "DELETE" && request.url().includes("/api/catalog-sources/source-team"));
    await page.getByRole("button", { name: "Remove Source" }).click();
    const removeDialog = page.getByRole("dialog");
    const removeAcknowledgement = removeDialog.locator('input[data-confirmation="acknowledgement"]');
    await expect.poll(() => removeAcknowledgement.evaluate(element => element === document.activeElement)).toBe(true);
    await removeAcknowledgement.check();
    const removeConfirm = page.waitForRequest(request => request.method() === "DELETE"); await removeDialog.getByRole("button", { name: "Confirm" }).click();
    await removeRequest; await removeConfirm;
    await page.getByRole("button", { name: "Reload Source Library" }).click();
    await page.waitForFunction(() => document.querySelector("[aria-busy]")?.getAttribute("aria-busy") === "false");
    await page.getByRole("button", { name: "Team Source" }).click();
    await page.waitForFunction(() => document.querySelector("[aria-busy]")?.getAttribute("aria-busy") === "false");
    await page.getByRole("button", { name: "Restore Source" }).waitFor({ state: "visible" });
    expect(await page.getByRole("button", { name: "Restore Source" }).isEnabled()).toBe(true);
    await page.getByRole("button", { name: "Restore Source" }).click();
    const restoreDialog = page.getByRole("dialog");
    const restoreAck = restoreDialog.locator('input[data-confirmation="acknowledgement"]');
    await page.evaluate(() => new Promise<void>(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))));
    await restoreAck.check();
    await page.waitForFunction(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const confirm = Array.from(dialog?.querySelectorAll("button") ?? []).find(button => button.textContent?.trim() === "Confirm") as HTMLButtonElement | undefined;
      return confirm?.disabled === false;
    });
    const restoreRequest = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/api/catalog-sources/source-team/restore");
    await restoreDialog.getByRole("button", { name: "Confirm" }).click();
    expect((await restoreRequest).postDataJSON()).toEqual({ expectedRevision: 6 });
    await page.waitForFunction(() => document.querySelector("[aria-busy]")?.getAttribute("aria-busy") === "false");
    await page.getByRole("button", { name: "Reload Source Library" }).click();
    await page.waitForFunction(() => document.querySelector("[aria-busy]")?.getAttribute("aria-busy") === "false");

    await page.getByRole("button", { name: /safe/ }).click();
    await page.waitForFunction(() => document.querySelector("[aria-busy]")?.getAttribute("aria-busy") === "false");
    await page.getByRole("button", { name: "Approve release" }).click();
    const dialog = page.getByRole("dialog");
    expect(await dialog.textContent()).toContain("APPROVE");
    expect(await dialog.textContent()).toContain(digest);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: /API APPROVE/ }).click();
    const approveDialog = page.getByRole("dialog"); expect(await approveDialog.textContent()).toContain("APPROVE");
    await approveDialog.locator('input[data-confirmation="acknowledgement"]').check();
    const approveRequest = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/api-execution/approve")); await approveDialog.getByRole("button", { name: "Confirm" }).click();
    const approved = await approveRequest; expect(approved.postDataJSON()).toEqual({ expectedRevision: 1, digest });
    await page.getByRole("button", { name: /API ACTIVATE/ }).click();
    const activateDialog = page.getByRole("dialog"); await activateDialog.locator('input[data-confirmation="acknowledgement"]').check();
    const activateRequest = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/api-execution/activate")); await activateDialog.getByRole("button", { name: "Confirm" }).click();
    expect((await activateRequest).postDataJSON()).toEqual({ expectedRevision: 2 });
    await page.getByRole("button", { name: /API DEACTIVATE/ }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: /API DEACTIVATE/ }).click();
    const deactivateDialog = page.getByRole("dialog"); await deactivateDialog.locator('input[data-confirmation="acknowledgement"]').check();
    const deactivateRequest = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/api-execution/deactivate")); await deactivateDialog.getByRole("button", { name: "Confirm" }).click();
    expect((await deactivateRequest).postDataJSON()).toEqual({ expectedRevision: 3 });
    await page.waitForFunction(() => document.activeElement?.tagName === "BUTTON");

    await page.getByRole("button", { name: "Grant organization" }).click();
    const orgDialog = page.getByRole("dialog"); expect(await orgDialog.textContent()).toContain("current and future users"); await orgDialog.locator('input[data-confirmation="acknowledgement"]').check();
    const orgRequest = page.waitForRequest(request => request.method() === "PUT" && request.url().endsWith("/grants/organization")); await orgDialog.getByRole("button", { name: "Confirm" }).click();
    expect((await orgRequest).postDataJSON()).toEqual({ expectedRevision: 0 });
    const humanGrant = page.getByRole("button", { name: "Grant human" }).first();
    if (await humanGrant.count()) {
      await humanGrant.click();
      const humanDialog = page.getByRole("dialog"); await humanDialog.locator('input[data-confirmation="acknowledgement"]').check();
      const humanRequest = page.waitForRequest(request => request.method() === "PUT" && request.url().includes("/grants/humans/human-b")); await humanDialog.getByRole("button", { name: "Confirm" }).click();
      expect((await humanRequest).postDataJSON()).toEqual({ expectedRevision: 0 });
    }

    await page.getByLabel("Target agent IDs (comma-separated, max 256)").fill("agent-a");
    await page.getByLabel("Operation").selectOption("SET_PRELOAD"); await page.getByLabel("Preload").selectOption("true");
    const planRequest = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/api/catalog-rollouts/plan"); await page.getByRole("button", { name: "Plan rollout" }).click();
    expect((await planRequest).postDataJSON()).toEqual({ releaseId: "release-skill", agentIds: ["agent-a"], operation: "SET_PRELOAD", preload: true });
    await page.getByRole("button", { name: "Confirm rollout" }).click();
    const rolloutDialog = page.getByRole("dialog"); await rolloutDialog.locator('input[data-confirmation="acknowledgement"]').check(); const confirmRolloutRequest = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/api/catalog-rollouts"); await rolloutDialog.getByRole("button", { name: "Confirm" }).click();
    expect((await confirmRolloutRequest).postDataJSON()).toEqual({ planDigest: digest, agentIds: ["agent-a"] });
    await page.getByText("Rollout status: QUEUED").waitFor({ state: "visible" });
    const cancelRolloutRequest = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/cancel")); await page.getByRole("button", { name: "Cancel rollout" }).click();
    expect((await cancelRolloutRequest).postDataJSON()).toEqual({ rolloutId: "rollout-1", expectedRevision: 1 });
    await page.getByLabel("Preload").selectOption("false"); const planAgain = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/api/catalog-rollouts/plan"); await page.getByRole("button", { name: "Plan rollout" }).click(); await planAgain;
    await page.getByRole("button", { name: "Confirm rollout" }).click();
    const rolloutDialogAgain = page.getByRole("dialog"); await rolloutDialogAgain.locator('input[data-confirmation="acknowledgement"]').check(); const confirmAgain = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/api/catalog-rollouts"); await rolloutDialogAgain.getByRole("button", { name: "Confirm" }).click(); await confirmAgain;
    await page.getByText("Rollout status: PARTIAL").waitFor({ state: "visible" });
    const retryRequest = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/retry-failed")); await page.getByRole("button", { name: "Retry eligible targets" }).click();
    expect((await retryRequest).postDataJSON()).toEqual({ rolloutId: "rollout-1", expectedRevision: 1 });
    expect(calls.some(call => call.includes("/api-execution/"))).toBe(true);
    await page.getByRole("button", { name: "Reload Source Library" }).focus();
    await page.locator("body").press("Tab");
    await page.waitForFunction(() => document.activeElement !== document.body);
    await page.evaluate(() => { history.pushState({}, "", "/?screen=source-library&source=missing&release=missing"); window.dispatchEvent(new PopStateEvent("popstate")); });
    await page.getByText("The requested Source Library selection is unavailable.").waitFor({ state: "visible" });
    expect(await page.evaluate(() => window.location.search)).toBe("?screen=source-library");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }, 60000);

  it("keeps desktop master/detail, tabs, URL selection, focus, and bounded metadata visible", async () => {
    if (!page) throw new Error("browser page was not created");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${appUrl}?screen=source-library`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Source Library", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Team Source" }).click();
    await page.getByRole("heading", { name: "Selected Source", exact: true }).waitFor({ state: "visible" });
    expect(await page.getByRole("button", { name: "Team Source" }).getAttribute("aria-pressed")).toBe("true");
    for (const tab of ["Overview", "Compatibility", "Contents", "Security", "Activity"]) {
      await page.getByRole("tab", { name: tab }).click();
      await page.getByRole("tabpanel").waitFor({ state: "visible" });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole("tab", { name: "Overview" }).focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  });
});

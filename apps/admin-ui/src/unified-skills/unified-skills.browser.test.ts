import { createServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
let baseUrl = "";
const inventoryUrls: string[] = [];
const digest = `sha256:${"c".repeat(64)}`;
const localItem = { ref: { kind: "LOCAL" as const, name: "safe", localOrigin: "BUILT_IN" as const }, description: "Safe local skill", readiness: { state: "READY" as const }, provenance: "BOUNDED_HUMAN" as const };
const catalogItem = { ref: { kind: "CATALOG" as const, packageReleaseId: "release-catalog", name: "catalog", version: "1.0.0", digest }, description: "Catalog skill", readiness: { state: "READY" as const }, provenance: "BOUNDED_HUMAN" as const };
const agentItem = { ref: { kind: "LOCAL" as const, name: "agent-skill", localOrigin: "WORKSPACE" as const }, description: "Agent skill", readiness: { state: "READY" as const }, provenance: "BOUNDED_HUMAN" as const };
const agentCatalogItem = { ...catalogItem, assignment: { desired: "DISABLED" as const, effective: "DISABLED" as const, preload: false, deployment: "STABLE" as const, revision: 3 } };
const tombstoneCatalogItem = { ref: { kind: "CATALOG" as const, packageReleaseId: "release-tombstone", name: "removed-catalog", version: "1.0.0", digest: `sha256:${"d".repeat(64)}` }, description: "Removed catalog skill", readiness: { state: "READY" as const }, provenance: "BOUNDED_HUMAN" as const };
const commandBodies: unknown[] = [];
let existingAgentRevision = 3;
const existingAgent = { id: "agent-a", name: "agent-a", runtimeState: "STOPPED", desiredState: "STOPPED", modelId: "model-a", workspacePath: ".orgops-data/workspaces/agent-a", enabledSkills: [], alwaysPreloadedSkills: [], revision: 3, visibility: "PUBLIC", mode: "CLASSIC" };
function executablePath() {
  const candidates = [process.env.ORGOPS_BROWSER_EXECUTABLE, "/usr/bin/google-chrome", "/opt/google/chrome/google-chrome"].filter((value): value is string => Boolean(value));
  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) throw new Error(`Chrome executable not found; checked ${candidates.join(", ")}`);
  return found;
}
function json(route: import("playwright-core").Route, body: unknown) { return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }); }

beforeAll(async () => {
  server = await createServer({ root, configFile: false, plugins: [react()], server: { host: "127.0.0.1", port: 0, hmr: false, proxy: {} } });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite did not expose a local URL");
  baseUrl = url;
  browser = await chromium.launch({ executablePath: executablePath(), headless: true, args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("**/api/**", async route => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;
    if (path === "/api/auth/me") return json(route, { id: "human-a", username: "human", isAdmin: false, mustChangePassword: false });
    if (path === "/api/skills/inventory") {
      inventoryUrls.push(requestUrl.pathname + requestUrl.search);
      return requestUrl.searchParams.has("agentId") ? json(route, { items: [agentItem, agentCatalogItem, tombstoneCatalogItem], agentRevision: existingAgentRevision }) : json(route, { items: [localItem, catalogItem] });
    }
    if (path === "/api/agents") return json(route, [existingAgent]);
    if (path === "/api/agents/agent-a/skills" && route.request().method() === "PATCH") {
      const command = JSON.parse(route.request().postData() ?? "null") as { kind?: string; expectedAgentRevision?: number; expectedAssignmentRevision?: number; packageReleaseId?: string };
      commandBodies.push(command); existingAgentRevision = (command.expectedAgentRevision ?? existingAgentRevision) + 1;
      return command.kind === "CATALOG" ? json(route, { ref: { kind: "CATALOG", packageReleaseId: command.packageReleaseId }, desired: "ENABLED", effective: "DISABLED", preload: false, deployment: "REQUESTED", revision: (command.expectedAssignmentRevision ?? 3) + 1, agentRevision: existingAgentRevision }) : json(route, { ref: { kind: "LOCAL", name: "agent-skill" }, desired: "ENABLED", effective: "ENABLED", preload: false, deployment: "STABLE", revision: 4, agentRevision: existingAgentRevision });
    }
    if (path === "/api/agents/agent-a/skills/history") return json(route, { events: [] });
    if (path === "/api/events/stats") return json(route, { total: 0, byStatus: {} });
    if (path.startsWith("/api/events")) return json(route, []);
    if (path === "/api/event-types") return json(route, { eventTypes: [] });
    if (path === "/api/runners" || path === "/api/teams" || path === "/api/channels" || path === "/api/processes" || path === "/api/secrets" || path === "/api/integration-keys" || path === "/api/agent-invites") return json(route, []);
    return json(route, {});
  });
  await page.goto(`${baseUrl}?screen=skills&tab=history`, { waitUntil: "domcontentloaded", timeout: 10000 });
});
afterAll(async () => { await page?.close().catch(() => undefined); await browser?.close().catch(() => undefined); await server?.close().catch(() => undefined); });

describe("Unified Skills real Chrome journeys", () => {
  it("reloads, navigates selections/history, filters agent context, and stays accessible at 390px", async () => {
    if (!page) throw new Error("browser page was not created");
    await page.getByRole("heading", { name: "Skills", exact: true }).waitFor({ state: "visible" });
    expect(await page.getByText("safe").count()).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Select safe" }).click();
    await page.getByRole("heading", { name: "safe", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Select catalog" }).click();
    await page.getByRole("heading", { name: "catalog", exact: true }).waitFor({ state: "visible" });
    await page.goBack(); await page.getByRole("heading", { name: "safe", exact: true }).waitFor({ state: "visible" });
    await page.goForward(); await page.getByRole("heading", { name: "catalog", exact: true }).waitFor({ state: "visible" });
    await page.getByLabel("Agent context").fill("agent-a");
    await page.getByText("agent-skill").waitFor({ state: "visible" });
    await page.getByLabel("Search").fill("agent");
    await page.getByRole("button", { name: "Reload Skills" }).click();
    await page.waitForFunction(() => Array.from(document.querySelectorAll("body *")).some(node => node.textContent === "agent-skill"));
    expect(inventoryUrls.some(value => value.includes("agentId=agent-a") && value.includes("q=agent"))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "Skills", exact: true }).focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  });

  it("manages an existing agent from its Skills tab", async () => {
    if (!page) throw new Error("browser page was not created");
    await page.goto(`${baseUrl}?screen=agents`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.getByText("agent-a", { exact: true }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Skills", exact: true }).click();
    await page.getByRole("heading", { name: "Skills", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("checkbox", { name: "Enable agent-skill" }).click();
    await page.getByText("Skill assignment saved for future turns.").waitFor({ state: "visible" });
    expect(commandBodies[0]).toMatchObject({ kind: "LOCAL", expectedAgentRevision: 3 });
    await page.getByRole("checkbox", { name: "Enable catalog" }).click();
    await page.getByRole("status").getByText("Waiting for agent to become idle", { exact: true }).waitFor({ state: "visible" });
    expect(commandBodies[1]).toMatchObject({ kind: "CATALOG", expectedAgentRevision: 4, expectedAssignmentRevision: 3 });
    await page.getByRole("checkbox", { name: "Enable removed-catalog" }).click();
    expect(commandBodies[2]).toMatchObject({ kind: "CATALOG", packageReleaseId: "release-tombstone", expectedAssignmentRevision: 0 });
    const tombstoneCard = page.locator("article").filter({ hasText: "removed-catalog" });
    expect(await tombstoneCard.textContent()).not.toContain("Revision: 9");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  it("normalizes retired Catalog URLs without rendering the old surface", async () => {
    if (!page) throw new Error("browser page was not created");
    await page.goto(`${baseUrl}?screen=catalogs`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.getByText("Administrator access is required. Recheck your sign-in and password status.").waitFor({ state: "visible" });
    expect(new URL(page.url()).searchParams.get("screen")).toBe("source-library");
    expect(await page.getByText("Catalog configuration").count()).toBe(0);
  });

  it("keeps desktop inventory/detail, agent context, history, and focus usable", async () => {
    if (!page) throw new Error("browser page was not created");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${baseUrl}?screen=skills&tab=history`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.getByRole("heading", { name: "Skills", exact: true }).waitFor({ state: "visible" });
    expect(await page.getByText("safe").count()).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Select catalog" }).click();
    await page.getByRole("heading", { name: "catalog", exact: true }).waitFor({ state: "visible" });
    await page.getByLabel("Agent context").fill("agent-a");
    await page.getByLabel("Search").fill("agent");
    await page.getByRole("button", { name: "Reload Skills" }).click();
    await page.getByText("agent-skill").waitFor({ state: "visible" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "Skills", exact: true }).focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  });
});

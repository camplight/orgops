import { createServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, type Browser, type Page, type Route } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const templateDependency = { kind: "CATALOG" as const, packageReleaseId: "release-skill", name: "dependency-skill", version: "2.1.0", digest: `sha256:${"b".repeat(64)}` };
const template = { packageReleaseId: "release-template", name: "reviewed-template", version: "1.2.3", digest: `sha256:${"a".repeat(64)}`, description: "Reviewed portable template", readiness: { state: "READY" as const }, mode: "CLASSIC" as const, exactConfig: { mode: "CLASSIC", systemInstructions: "Portable instructions", dependencySkills: [templateDependency], skillPreloads: ["dependency-skill"] }, skillRefs: [templateDependency], requirements: [] };
const options = { runners: [{ id: "runner-desktop" }], models: [{ id: "model-desktop" }], secretReferences: [], templates: [template] };
const receipt = { id: "desktop-agent", name: "desktop-agent", desiredState: "STOPPED" as const, runtimeState: "STOPPED" as const, queuedDeploymentIds: ["deployment-desktop"], startBlockers: [] };

function chromePath() {
  return [process.env.ORGOPS_BROWSER_EXECUTABLE, "/usr/bin/google-chrome", "/opt/google/chrome/google-chrome"].find(candidate => candidate && existsSync(candidate));
}
async function json(route: Route, value: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
}

describe("Create Agent desktop real Chrome acceptance", () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;
  let provisioned = 0;
  let readinessChecks = 0;
  let starts = 0;
  let readinessGate: Promise<void> | null = null;
  let releaseReadinessGate: (() => void) | null = null;
  let startGate: Promise<void> | null = null;
  let releaseStartGate: (() => void) | null = null;

  beforeAll(async () => {
    const executablePath = chromePath();
    if (!executablePath) throw new Error("Chrome executable not found");
    server = await createServer({ root, configFile: false, plugins: [react()], server: { host: "127.0.0.1", port: 0, hmr: false, proxy: {} } });
    await server.listen();
    browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route("**/api/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/me") return json(route, { id: "admin", username: "admin", isAdmin: true, mustChangePassword: false });
      if (path === "/api/agents" && request.method() === "GET") return json(route, provisioned ? [{ name: "desktop-agent", runtimeState: "STOPPED", desiredState: "STOPPED", modelId: "model-desktop", mode: "CLASSIC", visibility: "PUBLIC" }] : []);
      if (path === "/api/agents/template-options") return json(route, options);
      if (path === "/api/skills/inventory") return json(route, { items: [] });
      if (path === "/api/agents/provision" && request.method() === "POST") { provisioned += 1; return json(route, receipt, 201); }
      if (path === "/api/agents/desktop-agent/start-readiness") { readinessChecks += 1; if (readinessGate) await readinessGate; return json(route, readinessChecks === 1 ? { ready: false, queuedDeployment: true, blockers: [{ code: "DEPLOYMENT_REQUIRED" }] } : { ready: true, queuedDeployment: false, blockers: [] }); }
      if (path === "/api/agents/desktop-agent/start" && request.method() === "POST") { starts += 1; if (startGate) await startGate; return json(route, { ok: true }); }
      if (path === "/api/runners") return json(route, [{ id: "runner-desktop", displayName: "Desktop runner" }]);
      if (path === "/api/events/stats") return json(route, { total: 0, byStatus: {} });
      if (path.startsWith("/api/events")) return json(route, []);
      if (path === "/api/event-types") return json(route, { eventTypes: [] });
      if (["/api/channels", "/api/processes", "/api/secrets", "/api/integration-keys", "/api/agent-invites", "/api/teams", "/api/humans"].includes(path)) return json(route, []);
      return json(route, {});
    });
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error("Vite did not expose a URL");
    await page.goto(`${base}?screen=agents`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "New agent" }).waitFor({ state: "visible" });
  });

  afterAll(async () => {
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  });

  it("completes blank creation at desktop without overflow and keeps the stopped receipt", async () => {
    await page.getByRole("button", { name: "New agent" }).click();
    await page.getByRole("button", { name: "Blank agent" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Agent name").fill("desktop-agent");
    await page.getByLabel("Model").fill("model-desktop");
    await page.getByLabel("Assigned runner").selectOption("runner-desktop");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/I confirm this reviewed snapshot/).check();
    await page.getByRole("button", { name: "Create agent" }).click();
    await page.getByText("Created stopped; deployment queued").waitFor({ state: "visible" });
    expect(provisioned).toBe(1);
    expect(await page.getByRole("button", { name: "Start", exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "Refresh readiness" }).click();
    await page.getByText("DEPLOYMENT_REQUIRED").waitFor({ state: "visible" });
    expect(await page.getByRole("button", { name: "Start", exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "Refresh readiness" }).click();
    await page.getByRole("button", { name: "Start", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Start", exact: true }).click();
    expect(starts).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }, 60000);

  it("renders exact template identity, config, dependency refs, and preloads at 390px", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "New agent" }).click();
    await page.getByRole("button", { name: "Installed template" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Installed template").selectOption(template.packageReleaseId);
    const setup = page.getByLabel("Create agent setup");
    const selectedSummary = setup.getByLabel("Selected template identity and configuration");
    await selectedSummary.waitFor({ state: "visible" });
    for (const text of [template.name, template.version, template.packageReleaseId, template.digest, template.description, "READY", templateDependency.packageReleaseId, templateDependency.digest, "dependency-skill", "Portable instructions"]) await selectedSummary.getByText(text, { exact: false }).first().waitFor({ state: "visible" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Agent name").fill("template-agent");
    await page.getByLabel("Model").selectOption("model-desktop");
    await page.getByLabel("Assigned runner").selectOption("runner-desktop");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    const reviewSummary = setup.getByLabel("Reviewed template root and exact configuration");
    await reviewSummary.waitFor({ state: "visible" });
    for (const text of [template.name, template.version, template.packageReleaseId, template.digest, template.description, "READY", templateDependency.packageReleaseId, templateDependency.digest, "dependency-skill"]) await reviewSummary.getByText(text, { exact: false }).first().waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Cancel" }).click();
  }, 60000);

  it("ignores a deferred Start completion after the receipt is closed", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "New agent" }).click();
    await page.getByRole("button", { name: "Blank agent" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Agent name").fill("closed-start-agent");
    await page.getByLabel("Model").fill("model-desktop");
    await page.getByLabel("Assigned runner").selectOption("runner-desktop");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/I confirm this reviewed snapshot/).check();
    await page.getByRole("button", { name: "Create agent" }).click();
    await page.getByText("Created stopped; deployment queued").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Refresh readiness" }).click();
    await page.getByRole("button", { name: "Start", exact: true }).waitFor({ state: "visible" });
    const readinessBeforeStart = readinessChecks;
    startGate = new Promise<void>(resolveGate => { releaseStartGate = resolveGate; });
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("status").getByRole("button", { name: "Close", exact: true }).click();
    releaseStartGate?.(); startGate = null; releaseStartGate = null;
    await page.waitForTimeout(100);
    expect(readinessChecks).toBe(readinessBeforeStart);
  }, 60000);

  it("ignores a deferred readiness response after the authenticated principal changes", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "New agent" }).click();
    await page.getByRole("button", { name: "Blank agent" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Agent name").fill("desktop-agent");
    await page.getByLabel("Model").fill("model-desktop");
    await page.getByLabel("Assigned runner").selectOption("runner-desktop");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/I confirm this reviewed snapshot/).check();
    await page.getByRole("button", { name: "Create agent" }).click();
    await page.getByText("Created stopped; deployment queued").waitFor({ state: "visible" });
    readinessGate = new Promise<void>(resolveGate => { releaseReadinessGate = resolveGate; });
    await page.getByRole("button", { name: "Refresh readiness" }).click();
    await page.getByRole("button", { name: /log out|logout|sign out/i }).click();
    releaseReadinessGate?.(); readinessGate = null; releaseReadinessGate = null;
    await page.getByText("Sign in", { exact: true }).waitFor({ state: "visible" });
    expect(await page.getByRole("button", { name: "Start", exact: true }).count()).toBe(0);
  }, 60000);
});

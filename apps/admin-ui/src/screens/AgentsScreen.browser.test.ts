import { createServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, type Browser, type Locator, type Page, type Route } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProvisioningTemplateOptionsSchema, SkillInventoryItemSchema } from "@orgops/schemas";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const digestRequired = `sha256:${"d".repeat(64)}`;
const digestOptional = `sha256:${"e".repeat(64)}`;
const digestB = `sha256:${"f".repeat(64)}`;
const receipt = {
  id: "agent-created",
  name: "chrome-agent",
  desiredState: "STOPPED" as const,
  runtimeState: "STOPPED" as const,
  queuedDeploymentIds: ["deployment-created"],
  startBlockers: [{ code: "INSTALLATION_REQUIRED", item: "optional-skill" }],
  requirements: [{ name: "API_KEY", state: "SATISFIED" as const }]
};
const templateOptions = {
  runners: [{ id: "runner-template" }, { id: "runner-template-b" }],
  models: [{ id: "model-template" }, { id: "model-template-b" }],
  secretReferences: [{ name: "API_KEY", secretReferenceId: "opaque-secret-handle" }, { name: "B_API_KEY", secretReferenceId: "opaque-secret-handle-b" }],
  templates: [{
    packageReleaseId: "release-template", name: "template-agent", version: "1.0.0", digest: digestRequired, description: "Template agent", readiness: { state: "READY" as const },
    mode: "RLM_REPL" as const,
    exactConfig: {
      mode: "RLM_REPL",
      runtime: { memoryContextMode: "OFF" },
      skillPreloads: ["required-skill"],
      dependencySkills: [{ packageReleaseId: "release-required", name: "required-skill", version: "2.1.0", digest: digestRequired }]
    },
    skillRefs: [
      { kind: "CATALOG" as const, packageReleaseId: "release-required", name: "required-skill", version: "2.1.0", digest: digestRequired },
      { kind: "CATALOG" as const, packageReleaseId: "release-optional", name: "optional-skill", version: "3.2.0", digest: digestOptional }
    ],
    requirements: [{ name: "API_KEY", required: true }]
  }, {
    packageReleaseId: "release-template-b", name: "template-agent-b", version: "1.0.0", digest: digestB, description: "Template agent B", readiness: { state: "READY" as const },
    mode: "CLASSIC" as const,
    exactConfig: { mode: "CLASSIC", skillPreloads: ["b-required"] },
    skillRefs: [{ kind: "CATALOG" as const, packageReleaseId: "release-b-required", name: "b-required", version: "4.0.0", digest: digestB }],
    requirements: [{ name: "B_API_KEY", required: true }]
  }]
};
const inventoryItems = [
  { ref: templateOptions.templates[0].skillRefs[0], description: "Required", readiness: { state: "READY" as const }, provenance: "BOUNDED_HUMAN" as const },
  { ref: templateOptions.templates[0].skillRefs[1], description: "Optional", readiness: { state: "READY" as const }, provenance: "BOUNDED_HUMAN" as const },
  { ref: templateOptions.templates[1].skillRefs[0], description: "B required", readiness: { state: "READY" as const }, provenance: "BOUNDED_HUMAN" as const },
  { ref: { kind: "LOCAL" as const, name: "local-skill", localOrigin: "BUILT_IN" as const }, description: "Local", readiness: { state: "READY" as const }, provenance: "BOUNDED_HUMAN" as const }
];

function chromePath() {
  return [process.env.ORGOPS_BROWSER_EXECUTABLE, "/usr/bin/google-chrome", "/opt/google/chrome/google-chrome"].find((candidate) => candidate && existsSync(candidate));
}
async function json(route: Route, value: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
}
async function expectAttribute(locator: Locator, name: string, value: string) {
  await expect.poll(() => locator.getAttribute(name)).toBe(value);
}
async function expectVisible(locator: Locator) {
  await expect.poll(() => locator.isVisible()).toBe(true);
}
async function expectFocused(locator: Locator) {
  await expect.poll(() => locator.evaluate((element) => document.activeElement === element)).toBe(true);
}
async function expectValue(locator: Locator, value: string) {
  await expect.poll(() => locator.inputValue()).toBe(value);
}
async function expectChecked(locator: Locator, checked: boolean) {
  await expect.poll(() => locator.isChecked()).toBe(checked);
}
async function expectDisabled(locator: Locator, disabled: boolean) {
  await expect.poll(() => locator.isDisabled()).toBe(disabled);
}

ProvisioningTemplateOptionsSchema.parse(templateOptions);
for (const item of inventoryItems) SkillInventoryItemSchema.parse(item);


describe("Create Agent real Chrome390 journey", () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;
  let provisionBodies: Record<string, unknown>[];
  let provisionCount: number;
  let created: boolean;
  let agentsGetCount: number;
  let agentsPayloads: unknown[][];
  let optionsRequestCount: number;
  let optionsResponseCount: number;
  let delayNextOptions: boolean;
  let releaseDelayedOptions: () => void;
  let delayedOptions: Promise<void>;
  let delayedOptionsHandled: Promise<void>;
  let finishDelayedOptions: () => void;
  let storedReceiptByKey: Map<string, typeof receipt>;
let appUrl = "";

  beforeAll(async () => {
    const executablePath = chromePath();
    if (!executablePath) throw new Error("Chrome executable not found");
    server = await createServer({ root, configFile: false, plugins: [react()], server: { host: "127.0.0.1", port: 0, hmr: false, proxy: {} } });
    await server.listen();
    browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    provisionBodies = [];
    provisionCount = 0;
    created = false;
    agentsGetCount = 0;
    agentsPayloads = [];
    optionsRequestCount = 0;
    optionsResponseCount = 0;
    delayNextOptions = true;
    storedReceiptByKey = new Map();
    delayedOptions = new Promise<void>((resolveDelayed) => { releaseDelayedOptions = resolveDelayed; });
    delayedOptionsHandled = new Promise<void>((resolveHandled) => { finishDelayedOptions = resolveHandled; });

    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/auth/me") return json(route, { id: "admin", username: "admin", isAdmin: true, mustChangePassword: false });
      if (url.pathname === "/api/agents" && request.method() === "GET") {
        const agents = created ? [{ name: "chrome-agent", runtimeState: "STOPPED", desiredState: "STOPPED", modelId: "model-template", mode: "RLM_REPL", visibility: "PRIVATE" }] : [];
        agentsGetCount += 1;
        agentsPayloads.push(agents);
        return json(route, agents);
      }
      if (url.pathname === "/api/agents/template-options") {
        optionsRequestCount += 1;
        if (delayNextOptions) {
          delayNextOptions = false;
          await delayedOptions;
          try { await json(route, templateOptions); } catch { /* the client closed this request; fulfill was still attempted */ }
          optionsResponseCount += 1;
          finishDelayedOptions!();
          return;
        }
        await json(route, templateOptions);
        optionsResponseCount += 1;
        return;
      }
      if (url.pathname === "/api/skills/inventory") return json(route, { items: inventoryItems });
      if (url.pathname === "/api/skills") return json(route, []);
      if (url.pathname === "/api/runners") return json(route, [{ id: "runner-template", displayName: "Runner" }]);
      if (url.pathname === "/api/events/stats") return json(route, { total: 0, byStatus: {} });
      if (url.pathname.startsWith("/api/events")) return json(route, []);
      if (url.pathname === "/api/event-types") return json(route, { eventTypes: [] });
      if (["/api/channels", "/api/processes", "/api/secrets", "/api/integration-keys", "/api/agent-invites", "/api/teams", "/api/humans"].includes(url.pathname)) return json(route, []);
      if (url.pathname === "/api/agents/provision" && request.method() === "POST") {
        const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
        provisionCount += 1;
        provisionBodies.push(body);
        const key = String(body.idempotencyKey ?? "");
        if (!created) {
          created = true;
          storedReceiptByKey.set(key, receipt);
          await route.abort("connectionreset");
          return;
        }
        const stored = storedReceiptByKey.get(key);
        if (stored) return json(route, stored, 201);
        return json(route, receipt, 201);
      }
      return json(route, {});
    });

    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error("Vite did not expose a URL");
    appUrl = base;
    await page.goto(`${base}?screen=agents`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "New agent" }).waitFor({ state: "visible" });
  });

  afterAll(async () => {
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  });

  it("supports blank local-only setup and clears drafts on cancel", async () => {
    const invoker = page.getByRole("button", { name: "New agent" });
    await invoker.focus();
    await page.keyboard.press("Enter");
    const dialog = page.locator('[role="dialog"]');
    await expectAttribute(dialog, "aria-hidden", "false");
    await expect.poll(() => dialog.locator("input:focus,button:focus,select:focus").count()).toBe(1);

    await page.getByRole("button", { name: "Blank agent" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Agent name").fill("discarded-draft");
    await page.getByLabel("Assigned runner").selectOption("runner-template");
    await page.keyboard.press("Escape");
    await expectAttribute(dialog, "aria-hidden", "true");
    await expectFocused(invoker);
    expect(provisionCount).toBe(0);

    await invoker.press("Enter");
    await page.getByRole("button", { name: "Blank agent" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expectValue(page.getByLabel("Agent name"), "");
    await expectValue(page.getByLabel("Assigned runner"), "");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expectFocused(invoker);
  }, 80000);

  it("stages an exact installed template, retries one ambiguous POST, and stays private/stopped", async () => {
    const invoker = page.getByRole("button", { name: "New agent" });
    await invoker.press("Enter");
    const dialog = page.locator('[role="dialog"]');
    await page.getByRole("button", { name: "Installed template" }).click();
    await expect.poll(() => optionsRequestCount).toBe(1);
    await page.keyboard.press("Escape");
    await expectAttribute(dialog, "aria-hidden", "true");
    releaseDelayedOptions!();
    await delayedOptionsHandled;
    await expect.poll(() => optionsResponseCount).toBe(1);
    await expectFocused(invoker);

    await invoker.press("Enter");
    await page.getByRole("button", { name: "Installed template" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    const templateSelect = page.getByLabel("Installed template");
    await expect.poll(() => optionsRequestCount).toBe(2);
    await expect.poll(() => optionsResponseCount).toBe(2);
    await expect.poll(async () => (await templateSelect.locator("option").allTextContents()).some((text) => text.includes("release-template")), { timeout: 10000 }).toBe(true);
    await templateSelect.selectOption("release-template");
    await expectVisible(page.getByText("Dependency skill refs: 2"));
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Agent name").fill("chrome-agent");
    await page.getByLabel("Visibility").selectOption("PRIVATE");
    await page.getByLabel("Model").selectOption("model-template");
    await page.getByLabel("Assigned runner").selectOption("runner-template");
    await page.getByLabel(/API_KEY/).selectOption("1");
    await page.getByLabel("Create agent setup").getByRole("button", { name: "Back" }).click();
    await templateSelect.selectOption("release-template-b");
    await expectVisible(page.getByText("Dependency skill refs: 1"));
    await page.getByRole("button", { name: "Continue" }).click();
    await expectValue(page.getByLabel("Model"), "");
    await expectValue(page.getByLabel("Assigned runner"), "");
    await expectValue(page.getByLabel("B_API_KEY (required)"), "");
    await page.getByLabel("Model").selectOption("model-template-b");
    await page.getByLabel("Assigned runner").selectOption("runner-template-b");
    await page.getByLabel(/B_API_KEY/).selectOption("2");
    expect(await page.getByText("opaque-secret-handle").count()).toBe(0);
    await page.getByRole("button", { name: "Continue" }).click();

    const requiredCard = page.locator("label").filter({ hasText: "b-required" }).last();
    const optionalCard = page.locator("label").filter({ hasText: "b-required" }).last();
    await expectChecked(page.getByRole("checkbox", { name: "Select b-required" }), true);
    await expect.poll(() => requiredCard.getByRole("checkbox").count()).toBe(2);
    await expectChecked(requiredCard.getByRole("checkbox").nth(1), true);
    await expectDisabled(requiredCard.getByRole("checkbox").first(), true);
    await expectDisabled(optionalCard.getByRole("checkbox").first(), true);
    const optionalSelection = page.getByRole("checkbox", { name: "Select local-skill" });
    await optionalSelection.check();
    await expectChecked(optionalSelection, true);
    await optionalSelection.uncheck();
    await expectChecked(optionalSelection, false);
    await optionalSelection.check();
    await expectChecked(optionalSelection, true);
    await page.getByRole("button", { name: "Continue" }).click();

    await expectVisible(page.getByText(new RegExp(`b-required 4\\.0\\.0 ${digestB} · preload`)));
    expect(await page.getByText("required-skill").count()).toBe(0);
    expect(await page.getByText("optional-skill").count()).toBe(0);
    await expectVisible(page.getByText(/Missing secret bindings: None/));
    await page.getByLabel(/I confirm this reviewed snapshot/).check();
    const create = dialog.locator("button").filter({ hasText: /Create agent|Working\.\.\./ });
    await create.dispatchEvent("click");
    await expect.poll(() => page.getByRole("alert").textContent()).toContain("server is unavailable");
    await expectVisible(page.getByText("Review and confirm"));
    expect(provisionCount).toBe(1);

    const first = provisionBodies[0]!;
    expect(first).toMatchObject({
      kind: "TEMPLATE",
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "chrome-agent",
      visibility: "PRIVATE",
      packageReleaseId: "release-template-b",
      modelId: "model-template-b",
      runnerId: "runner-template-b",
      secretBindings: [{ requirementName: "B_API_KEY", secretReferenceId: "opaque-secret-handle-b" }],
      localSkills: [{ name: "local-skill", preload: false }]
    });
    expect(first).not.toHaveProperty("rawSecret");
    expect(first.catalogSkills).toEqual([{ packageReleaseId: "release-b-required", preload: true }]);
    await Promise.all([create.dispatchEvent("click"), create.dispatchEvent("click")]);
    await expectVisible(page.getByText("Created stopped; deployment queued"));
    expect(provisionCount).toBe(2);
    expect(provisionBodies[1]?.idempotencyKey).toBe(first.idempotencyKey);
    expect(new Set(provisionBodies.map((body) => body.name)).size).toBe(1);
    expect(await page.getByText("Start now").count()).toBe(0);
    await expect.poll(() => agentsGetCount).toBeGreaterThan(1);
    expect(agentsPayloads.some((agents) => agents.some((agent) => (agent as { name?: string }).name === "chrome-agent"))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }, 80000);

  it("keeps the exact template review composite usable at desktop", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${appUrl}?screen=agents`, { waitUntil: "domcontentloaded" });
    const invoker = page.getByRole("button", { name: "New agent" });
    await invoker.press("Enter");
    await page.getByRole("button", { name: "Installed template" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    const templateSelect = page.getByLabel("Installed template");
    await expect.poll(() => optionsRequestCount).toBeGreaterThan(2);
    await templateSelect.selectOption("release-template");
    await expectVisible(page.getByText("Dependency skill refs: 2"));
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Agent name").fill("desktop-template-agent");
    await page.getByLabel("Model").selectOption("model-template");
    await page.getByLabel("Assigned runner").selectOption("runner-template");
    await page.getByLabel(/API_KEY/).selectOption("1");
    await page.getByRole("button", { name: "Continue" }).click();
    await expectChecked(page.getByRole("checkbox", { name: "Select required-skill" }), true);
    await page.getByRole("button", { name: "Continue" }).click();
    await expectVisible(page.getByText(/required-skill 2\.1\.0/));
    await expectVisible(page.getByText(/Catalog selections create this agent stopped; deployment is queued/i));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }, 80000);
});

import { createServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, type Browser, type Page, type Route } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const channels = [
  { id: "channel-1", name: "general", description: "General discussion", kind: "CHANNEL", visibility: "PUBLIC", participants: [] },
  { id: "channel-2", name: "second", description: "Second discussion", kind: "CHANNEL", visibility: "PUBLIC", participants: [] }
];

function chromePath() {
  return [process.env.ORGOPS_BROWSER_EXECUTABLE, "/usr/bin/google-chrome", "/opt/google/chrome/google-chrome"].find((candidate) => candidate && existsSync(candidate));
}

async function json(route: Route, value: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
}

async function waitForConversation(page: Page) {
  await page.getByRole("navigation", { name: "Main navigation" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Conversations", exact: true }).waitFor({ state: "visible" });
}

describe("user workspace retired Library browser coverage", () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;
  let base: string;
  let loggedIn: boolean;
  let mustChangePassword: boolean;
  let unsafeLibraryRequests: string[];

  beforeAll(async () => {
    const executablePath = chromePath();
    if (!executablePath) throw new Error("Chrome executable not found");
    server = await createServer({ root, configFile: false, plugins: [react()], server: { host: "127.0.0.1", port: 0, hmr: false, proxy: {} } });
    await server.listen();
    base = server.resolvedUrls?.local[0] ?? "";
    if (!base) throw new Error("Vite did not expose a URL");
    browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    loggedIn = true;
    mustChangePassword = false;
    unsafeLibraryRequests = [];
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (url.pathname.startsWith("/api/" + "library")) {
        unsafeLibraryRequests.push(`${request.method()} ${url.pathname}`);
        return json(route, { error: "retired endpoint called" }, 500);
      }
      if (url.pathname === "/api/auth/me") {
        return loggedIn
          ? json(route, { id: "human-1", username: "alice", mustChangePassword })
          : json(route, { error: "Unauthorized" }, 401);
      }
      if (url.pathname === "/api/auth/login" && request.method() === "POST") {
        loggedIn = true;
        return json(route, { ok: true });
      }
      if (url.pathname === "/api/auth/logout" && request.method() === "POST") {
        loggedIn = false;
        mustChangePassword = false;
        return json(route, { ok: true });
      }
      if (url.pathname === "/api/auth/profile" && request.method() === "PATCH") {
        mustChangePassword = false;
        return json(route, { ok: true });
      }
      if (url.pathname === "/api/channels") return json(route, channels);
      if (url.pathname === "/api/agents") return json(route, [{ name: "agent-a", runtimeState: "RUNNING", visibility: "PUBLIC" }]);
      if (url.pathname === "/api/humans") return json(route, []);
      if (url.pathname === "/api/teams/me") return json(route, []);
      if (url.pathname === "/api/events") return json(route, []);
      return json(route, {});
    });
  });

  afterAll(async () => {
    await page?.close();
    await browser?.close();
    await server?.close();
  });

  it("normalizes retired paths and preserves valid and invalid conversation deep links", async () => {
    const retiredPath = "/" + "library";
    await page.goto(`${base}${retiredPath}?channel=channel-1#messages`, { waitUntil: "domcontentloaded" });
    await waitForConversation(page);
    await page.getByRole("heading", { name: "general" }).waitFor({ state: "visible" });
    expect(new URL(page.url()).pathname).toBe("/");
    expect(new URL(page.url()).search).toBe("?channel=channel-1");
    expect(new URL(page.url()).hash).toBe("#messages");
    expect(await page.getByText(/Library|Skills|Source Library/i).count()).toBe(0);
    expect(unsafeLibraryRequests).toEqual([]);

    await page.goto(`${base}${retiredPath}/?channel=missing#messages`, { waitUntil: "domcontentloaded" });
    await waitForConversation(page);
    await page.getByRole("heading", { name: "general" }).waitFor({ state: "visible" });
    expect(new URL(page.url()).pathname).toBe("/");
    expect(new URL(page.url()).search).toBe("?channel=channel-1");
    expect(unsafeLibraryRequests).toEqual([]);
  });

  it("keeps channel history functional across back/forward and remains usable at Chrome390", async () => {
    await page.goto(`${base}/?channel=channel-1`, { waitUntil: "domcontentloaded" });
    await waitForConversation(page);
    await page.getByRole("button", { name: "# second", exact: true }).click();
    await page.getByRole("heading", { name: "second" }).waitFor({ state: "visible" });
    expect(new URL(page.url()).search).toBe("?channel=channel-2");
    await page.goBack();
    await page.getByRole("heading", { name: "general" }).waitFor({ state: "visible" });
    await page.goForward();
    await page.getByRole("heading", { name: "second" }).waitFor({ state: "visible" });

    await page.evaluate(() => {
      history.pushState({}, "", "/" + "library" + "?channel=channel-1#messages");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await page.getByRole("heading", { name: "general" }).waitFor({ state: "visible" });
    expect(new URL(page.url()).pathname).toBe("/");
    expect(new URL(page.url()).search).toBe("?channel=channel-1");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.getByRole("button", { name: "Conversations", exact: true }).count()).toBe(1);
    expect(unsafeLibraryRequests).toEqual([]);
  });

  it("preserves password-change, logout, and login flows without a retired route", async () => {
    mustChangePassword = true;
    await page.goto(`${base}/${"library"}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Set a new password" }).waitFor({ state: "visible" });
    expect(new URL(page.url()).pathname).toBe("/");
    await page.getByLabel("New password", { exact: true }).fill("new-password");
    await page.getByLabel("Confirm new password", { exact: true }).fill("new-password");
    await page.getByRole("button", { name: "Update password" }).click();
    await waitForConversation(page);
    await page.getByRole("button", { name: /Sign out/ }).click();
    await page.getByRole("heading", { name: "Welcome back" }).waitFor({ state: "visible" });
    loggedIn = false;
    await page.getByLabel("Password").fill("test-password");
    await page.getByRole("button", { name: "Continue" }).click();
    await waitForConversation(page);
    expect(unsafeLibraryRequests).toEqual([]);
  });
});

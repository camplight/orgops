import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeRetiredLibraryPath } from "./App";

const appSource = readFileSync(resolve(process.cwd(), "apps/user-ui/src/App.tsx"), "utf8");

describe("retired user catalog surface", () => {
  it("normalizes the retired URL to conversations while preserving channel deep links", () => {
    const retiredScreen = ["Library", "Screen"].join("");
    const retiredLibraryDir = ["library", "/"].join("");
    expect(appSource).toContain("normalizeRetiredLibraryPath");
    expect(appSource).toContain('window.history.replaceState(null, "", url)');
    expect(appSource).not.toContain(`from "./${retiredScreen}"`);
    expect(appSource).not.toContain(`from "./${retiredLibraryDir}api"`);
    expect(appSource).not.toContain(`from "./${retiredLibraryDir}state"`);
    expect(appSource).not.toMatch(/activeScreen.*library/);
    expect(appSource).not.toMatch(/>[\s]*Library[\s]*</);

    const originalWindow = globalThis.window;
    const location = new URL(`https://example.test/${"library"}?channel=channel-1#messages`);
    let replacement = "";
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location, history: { replaceState: (_state: unknown, _title: string, url: URL) => { replacement = url.toString(); } } }
    });
    try {
      normalizeRetiredLibraryPath();
      expect(replacement).toBe("https://example.test/?channel=channel-1#messages");
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
  });
});

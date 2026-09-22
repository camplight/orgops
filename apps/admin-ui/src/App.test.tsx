import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AuthSnapshot } from "./auth-session";
import type { Screen } from "./types";

const fixture = vi.hoisted(() => ({ screen: "dashboard" as Screen, auth: {} as AuthSnapshot }));
// SSR navigation fixture changes only App's initial dashboard selection, never capability.
vi.mock("react", async importOriginal => {
  const real = await importOriginal<typeof import("react")>();
  const useState: typeof real.useState = ((initial: unknown) => {
    const tuple = real.useState(initial);
    const resolved = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return resolved === "dashboard" ? [fixture.screen, tuple[1]] : tuple;
  }) as typeof real.useState;
  return { ...real, useState };
});
vi.mock("./hooks/useAuth", () => ({ useAuth: () => ({ ...fixture.auth, refreshAuth: async () => fixture.auth, invalidateCatalogAuthority: () => {}, logout: async () => {} }) }));
vi.mock("./hooks/useWebSocket", () => ({ useWebSocket: () => {} }));
// Real data-hook initial shape, with SSR effects unexecuted; no eager network calls.
vi.mock("./hooks/useOrgOpsData", async importOriginal => {
  const real = await importOriginal<typeof import("./hooks/useOrgOpsData")>();
  return { useOrgOpsData: real.useOrgOpsData };
});
import App, { buildAdminPrincipalKey, normalizeAdminScreen } from "./App";

beforeEach(() => {
  fixture.screen = "dashboard";
  fixture.auth = { authChecked: true, authenticated: true, username: "admin", userId: "human-1", isAdmin: false, mustChangePassword: false };
});
describe("App auth and Catalogs integration", () => {
  it("preserves unchecked loading and signed-out login", () => {
    fixture.auth.authChecked = false; expect(renderToStaticMarkup(<App />)).toContain("Loading...");
    fixture.auth.authChecked = true; fixture.auth.authenticated = false;
    const html = renderToStaticMarkup(<App />); expect(html).toContain("Sign in"); expect(html).not.toContain('>Source Library</button>');
  });
  it("builds one capability-aware principal key for every privileged entrypoint", () => {
    expect(buildAdminPrincipalKey({ userId: "human-1", username: "admin", isAdmin: true, mustChangePassword: false, authenticated: true })).toBe("human-1:admin:admin=1:password=0:authenticated=1");
    expect(buildAdminPrincipalKey({ userId: "human-1", username: "admin", isAdmin: false, mustChangePassword: false, authenticated: true })).not.toBe(buildAdminPrincipalKey({ userId: "human-1", username: "admin", isAdmin: true, mustChangePassword: false, authenticated: true }));
  });

  it("does not infer capability from admin username", () => {
    const html = renderToStaticMarkup(<App />); expect(html).toContain('>Dashboard</button>'); expect(html).toContain('>Skills</button>'); expect(html).not.toContain('>Source Library</button>');
  });
  it("shows the catalog entry to renamed administrators", () => {
    fixture.auth.username = "renamed"; fixture.auth.isAdmin = true;
    expect(renderToStaticMarkup(<App />)).toContain('>Source Library</button>');
  });
  it("normalizes retired Catalog URLs to Source Library for initial and history navigation", () => {
    expect(normalizeAdminScreen("catalogs")).toBe("source-library");
    expect(normalizeAdminScreen("skills")).toBe("skills");
    expect(normalizeAdminScreen("unknown")).toBe("dashboard");
  });
  it("immediately uses existing forced-password Profile flow instead of selected catalogs", () => {
    fixture.screen = "source-library"; fixture.auth.isAdmin = true; fixture.auth.mustChangePassword = true;
    const html = renderToStaticMarkup(<App />); expect(html).toContain("Set a new password before continuing"); expect(html).not.toContain('>Source Library</button>');
  });
  it("signed-out stale selection never mounts catalog management", () => {
    fixture.screen = "source-library"; fixture.auth.authenticated = false;
    expect(renderToStaticMarkup(<App />)).toContain("Sign in");
  });
  it("preserves ordinary Profile navigation", () => {
    fixture.screen = "profile"; const html = renderToStaticMarkup(<App />); expect(html).toContain("Save Profile"); expect(html).not.toContain("Set a new password before continuing");
  });
});

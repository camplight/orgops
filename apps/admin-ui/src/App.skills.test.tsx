import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./hooks", () => {
  const skills = [
    {
      name: "private-from-response",
      description: "Projected from the /api/skills response",
      path: "/private/skills/private-from-response",
      root: { kind: "EXTERNAL", path: "/private/skills" },
    },
  ];
  const noop = () => undefined;
  const data = new Proxy(
    { skills },
    {
      get(target, property: string) {
        if (property in target) return target[property as keyof typeof target];
        if (property === "dashboardEventStats") {
          return { total: 0, processed: 0, failed: 0, pending: 0, scheduled: 0 };
        }
        if (property === "apiFetch") return async () => new Response();
        if (property === "apiJson") return async () => [];
        if (property === "getApiHeaders") return () => ({});
        if (property.startsWith("set") || property.startsWith("refresh") || property.startsWith("load")) {
          return noop;
        }
        return [];
      },
    },
  );
  return {
    useAuth: () => ({
      authChecked: true,
      authenticated: true,
      username: "fixture",
      mustChangePassword: false,
      refreshAuth: noop,
      logout: noop,
    }),
    useOrgOpsData: () => data,
    useWebSocket: noop,
  };
});

vi.mock("./components/layout", () => ({
  AppLayout: ({ children }: { children: unknown }) => children,
  LoginForm: () => null,
}));

vi.mock("./components/drawers/DashboardDrawers", () => ({
  DashboardDrawers: ({ skills }: { skills: Array<{ name: string }> }) => (
    <div data-testid="agent-skill-selector">{skills.map((skill) => skill.name).join(",")}</div>
  ),
}));

vi.mock("./screens", () => {
  const Empty = () => null;
  return {
    DashboardScreen: Empty,
    AgentInvitesScreen: Empty,
    AgentsScreen: Empty,
    TeamsScreen: Empty,
    ChannelsScreen: Empty,
    ChatScreen: Empty,
    EventsScreen: Empty,
    ProcessesScreen: Empty,
    RunnersScreen: Empty,
    SkillsScreen: Empty,
    SecretsScreen: Empty,
    IntegrationKeysScreen: Empty,
    HumansScreen: Empty,
    ProfileScreen: Empty,
  };
});

describe("App skills projection", () => {
  it("passes response.skills to agent selectors instead of the discovery object", async () => {
    const { default: App } = await import("./App");
    const markup = renderToStaticMarkup(<App />);
    expect(markup).toContain("data-testid=\"agent-skill-selector\">");
    expect(markup).toContain("private-from-response");
    expect(markup).not.toContain("conflicts");
  });
});

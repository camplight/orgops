import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CreateAgentFlow } from "./AgentsScreen";

const props = {
  agents: [], runners: [], skills: [], onProvisionAgent: vi.fn(async () => ({ id: "agent-1", name: "agent-1", desiredState: "STOPPED" as const, runtimeState: "STOPPED" as const, queuedDeploymentIds: [], startBlockers: [] })), onUpdateAgent: vi.fn(async () => {}),
  onDeleteAgent: vi.fn(async () => {}), onStartAgent: vi.fn(async () => {}), onStopAgent: vi.fn(async () => {}),
  onCleanupAgentWorkspace: vi.fn(async () => {}), loadAgentCrossMemory: vi.fn(async () => ({ recent: "", full: "" })),
  loadAgentEvents: vi.fn(async () => []), loadAgentWorkspace: vi.fn(async () => ({ workspacePath: ".", path: ".", entries: [] })),
  loadAgentWorkspaceFile: vi.fn(async () => ({ path: "x", name: "x", size: 0, modifiedAt: 0, content: "" })),
  loadAgentSystemPrompt: vi.fn(async () => ({ found: false })), onDownloadAgentWorkspaceFile: vi.fn(),
};

describe("AgentsScreen staged creation", () => {
  it("advertises an origin step instead of the legacy direct create form", () => {
    const html = renderToStaticMarkup(<CreateAgentFlow {...props} onCancel={() => {}} onDone={() => {}} />);
    expect(html).toContain("Installed template");
    expect(html).toContain("Blank agent");
  });
});

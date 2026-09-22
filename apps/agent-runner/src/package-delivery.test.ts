import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { exportSkillPackage } from "@orgops/skills";
import type { DeploymentCommand, RunnerCatalogClient, VerifiedArtifactEnvelope } from "@orgops/schemas";
import { computeArtifactSemanticDigest, computePackageSetDigest, createPackageDeploymentProcessor, verifyArtifact } from "./package-delivery";
import { createRunnerApi, RunnerApiHttpError } from "./runner/api";
import { createRunnerState } from "./runner/state";

const commit = "a".repeat(40);
afterEach(() => vi.unstubAllGlobals());
function fixture(): { command: DeploymentCommand; artifact: VerifiedArtifactEnvelope } {
  const exported = exportSkillPackage([{ type: "file", path: "SKILL.md", base64: Buffer.from("---\nname: alpha\ndescription: Alpha.\n---\n").toString("base64"), executable: false }], {
    metadata: { formatVersion: 1, name: "alpha", version: "1.0.0", description: "Alpha.", author: "Test", license: "MIT",
      compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [] },
    dependencies: [], executables: [], selectedPaths: ["SKILL.md"],
  });
  if (!exported.ok) throw new Error("fixture");
  const manifest = exported.value.snapshot.manifest;
  const release = { packageReleaseId: "release-alpha", authoritySourceId: "source-a", contentSourceId: "source-a", kind: "skill" as const,
    name: "alpha", version: "1.0.0", catalogCommit: commit, packageCommit: commit, packagePath: "skills/alpha", digest: manifest.digest };
  const packages = [{ release, manifest, direct: true,
    namespace: `packages/000-alpha-${createHash("sha256").update("release-alpha").digest("hex").slice(0, 12)}` }];
  const files = exported.value.snapshot.files.map(file => ({ packageReleaseId: "release-alpha", path: file.path,
    mode: file.executable ? 0o755 as const : 0o644 as const, bytesBase64: file.base64 }));
  const artifact = { deploymentId: "deploy-a", agentId: "agent-a", generation: "generation-a", release, manifest,
    dependencies: [], packages, semanticDigest: "", files } as VerifiedArtifactEnvelope;
  artifact.semanticDigest = computeArtifactSemanticDigest(artifact);
  return { command: { deploymentId: "deploy-a", agentId: "agent-a", agentName: "agent-a", assignedRunnerId: "runner-a",
    releaseId: "release-alpha", desiredGeneration: "generation-a", desiredRoots: [release], packageSetDigest: computePackageSetDigest([release]) }, artifact };
}

it.each(["wrong-release", "wrong-digest", "wrong-agent", "noncanonical-base64", "extra-file", "oversized"] as const)("rejects %s before staging", variant => {
  const { command, artifact } = fixture();
  const changed = structuredClone(artifact) as any;
  if (variant === "wrong-release") changed.release.packageReleaseId = "release-other";
  if (variant === "wrong-digest") changed.semanticDigest = `sha256:${"0".repeat(64)}`;
  if (variant === "wrong-agent") changed.agentId = "agent-other";
  if (variant === "noncanonical-base64") changed.files[0].bytesBase64 += "=";
  if (variant === "extra-file") changed.files.push({ ...changed.files[0], path: "extra.txt" });
  if (variant === "oversized") changed.files[0].bytesBase64 = Buffer.alloc(1_048_577).toString("base64");
  expect(verifyArtifact(command, changed)).toEqual({ ok: false, code: "INSPECTION_FAILED" });
});

it("accepts only the command-bound root set, package order, namespace, and package-set digest", () => {
  const { command, artifact } = fixture();
  expect(verifyArtifact(command, artifact)).toEqual({ ok: true, value: artifact });
  const namespace = structuredClone(artifact);
  namespace.packages[0]!.namespace = "packages/007-alpha";
  namespace.semanticDigest = computeArtifactSemanticDigest(namespace);
  expect(verifyArtifact(command, namespace)).toEqual({ ok: false, code: "INSPECTION_FAILED" });
  expect(verifyArtifact({ ...command, packageSetDigest: `sha256:${"0".repeat(64)}` }, artifact))
    .toEqual({ ok: false, code: "INSPECTION_FAILED" });
  expect(verifyArtifact({ ...command, desiredRoots: [] }, artifact)).toEqual({ ok: false, code: "INSPECTION_FAILED" });
});

it("rejects an API-added unrelated direct package even when the envelope digest is recomputed", () => {
  const { command, artifact } = fixture();
  const exported = exportSkillPackage([{ type: "file", path: "SKILL.md", base64: Buffer.from("---\nname: beta\ndescription: Beta.\n---\n").toString("base64"), executable: false }], {
    metadata: { formatVersion: 1, name: "beta", version: "1.0.0", description: "Beta.", author: "Test", license: "MIT",
      compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [] },
    dependencies: [], executables: [], selectedPaths: ["SKILL.md"],
  });
  if (!exported.ok) throw new Error("fixture");
  const manifest = exported.value.snapshot.manifest;
  const release = { ...artifact.release, packageReleaseId: "release-beta", name: "beta", packagePath: "skills/beta", digest: manifest.digest };
  const changed = structuredClone(artifact) as any;
  changed.packages.push({ release, manifest, direct: true,
    namespace: `packages/001-beta-${createHash("sha256").update("release-beta").digest("hex").slice(0, 12)}` });
  changed.files.push(...exported.value.snapshot.files.map(file => ({ packageReleaseId: "release-beta", path: file.path,
    mode: file.executable ? 0o755 as const : 0o644 as const, bytesBase64: file.base64 })));
  changed.dependencies.push({ release, direct: true });
  changed.semanticDigest = computeArtifactSemanticDigest(changed);
  expect(verifyArtifact(command, changed)).toEqual({ ok: false, code: "INSPECTION_FAILED" });
});

it("reports staged, waiting before activation, and active in exact order while isolating failures", async () => {
  const first = fixture();
  const second = fixture();
  second.command.deploymentId = "deploy-b";
  second.artifact.deploymentId = "deploy-b";
  second.artifact.semanticDigest = computeArtifactSemanticDigest(second.artifact);
  const calls: string[] = [];
  const api: RunnerCatalogClient = {
    listPackageDeployments: async () => (calls.push("list"), [first.command, second.command]),
    claimPackageDeployment: async id => (calls.push(`claim:${id}`), { deploymentId: id, attemptToken: "x".repeat(43), leaseExpiresAt: 99 }),
    getPackageArtifact: async id => (calls.push(`artifact:${id}`), id === "deploy-a" ? first.artifact : second.artifact),
    reportPackageDeployment: async (id, _token, report) => (calls.push(`report:${id}:${report.state}`), { deploymentId: id, state: report.state, revision: 1 }),
  };
  let stages = 0;
  await createPackageDeploymentProcessor({ api, runtime: {
    stage: async (_command, artifact) => {
      stages++;
      if (artifact.deploymentId === "deploy-a") throw new Error("private disk path");
      calls.push(`stage:${artifact.deploymentId}`);
      return { agentId: artifact.agentId, deploymentId: artifact.deploymentId,
        generation: { generation: artifact.generation, skillRoot: "/safe", promptRoot: "/safe", eventShapeRoot: "/safe" }, stagedRoot: "/safe",
        packageSetDigest: first.command.packageSetDigest, semanticDigest: artifact.semanticDigest };
    },
    activateWhenIdle: async staged => (calls.push(`activate:${staged.deploymentId}`), { agentId: staged.agentId, deploymentId: staged.deploymentId, generation: staged.generation.generation }),
    captureForTurn: async () => { throw new Error("unused"); },
  } }).processPackageDeployments();
  expect(stages).toBe(2);
  expect(calls).toEqual([
    "list", "claim:deploy-a", "artifact:deploy-a", "report:deploy-a:FAILED",
    "claim:deploy-b", "artifact:deploy-b", "stage:deploy-b", "report:deploy-b:STAGED",
    "report:deploy-b:WAITING_FOR_IDLE", "activate:deploy-b", "report:deploy-b:ACTIVE",
  ]);
});

it.each([
  [422, "INSPECTION_FAILED", true],
  [401, "FORBIDDEN", false],
  [403, "FORBIDDEN", false],
  [404, "NOT_FOUND", false],
  [409, "DEPLOYMENT_SUPERSEDED", false],
  [500, "STORAGE_FAILURE", false],
] as const)("classifies artifact HTTP %s/%s without destroying last-good", async (status, code, shouldReport) => {
  const { command } = fixture();
  const reports: string[] = [];
  const api: RunnerCatalogClient = {
    listPackageDeployments: async () => [command],
    claimPackageDeployment: async () => ({ deploymentId: command.deploymentId, attemptToken: "x".repeat(43), leaseExpiresAt: 99 }),
    getPackageArtifact: async () => { throw new RunnerApiHttpError(status, code, "/artifact"); },
    reportPackageDeployment: async (_id, _token, report) => {
      reports.push(`${report.state}:${report.failureCode ?? ""}`);
      return { deploymentId: command.deploymentId, state: report.state, revision: 1 };
    },
  };
  await createPackageDeploymentProcessor({ api, runtime: { stage: async () => { throw new Error("unused"); },
    activateWhenIdle: async () => { throw new Error("unused"); }, captureForTurn: async () => { throw new Error("unused"); } } }).processPackageDeployments();
  expect(reports).toEqual(shouldReport ? ["FAILED:INSPECTION_FAILED"] : []);
});

it.each([
  ["network", new Error("network secret should not leak")],
  ["malformed body", new RunnerApiHttpError(422, undefined, "/artifact")],
] as const)("keeps %s artifact failures retryable", async (_label, error) => {
  const { command } = fixture();
  const reports: string[] = [];
  const api: RunnerCatalogClient = {
    listPackageDeployments: async () => [command],
    claimPackageDeployment: async () => ({ deploymentId: command.deploymentId, attemptToken: "x".repeat(43), leaseExpiresAt: 99 }),
    getPackageArtifact: async () => { throw error; },
    reportPackageDeployment: async (_id, _token, report) => {
      reports.push(`${report.state}:${report.failureCode ?? ""}`);
      return { deploymentId: command.deploymentId, state: report.state, revision: 1 };
    },
  };
  await createPackageDeploymentProcessor({ api, runtime: { stage: async () => { throw new Error("unused"); },
    activateWhenIdle: async () => { throw new Error("unused"); }, captureForTurn: async () => { throw new Error("unused"); } } }).processPackageDeployments();
  expect(reports).toEqual([]);
});

it("reports activation storage failure after waiting without converting report transport ambiguity", async () => {
  const { command, artifact } = fixture();
  const calls: string[] = [];
  const api: RunnerCatalogClient = {
    listPackageDeployments: async () => [command],
    claimPackageDeployment: async () => ({ deploymentId: command.deploymentId, attemptToken: "x".repeat(43), leaseExpiresAt: 99 }),
    getPackageArtifact: async () => artifact,
    reportPackageDeployment: async (_id, _token, report) => {
      calls.push(report.state === "FAILED" ? `FAILED:${report.failureCode}` : report.state);
      return { deploymentId: command.deploymentId, state: report.state, revision: calls.length };
    },
  };
  await createPackageDeploymentProcessor({ api, runtime: {
    stage: async () => ({ agentId: "agent-a", deploymentId: "deploy-a",
      generation: { generation: "generation-a", skillRoot: "/safe", promptRoot: "/safe", eventShapeRoot: "/safe" }, stagedRoot: "/safe",
      packageSetDigest: command.packageSetDigest, semanticDigest: artifact.semanticDigest }),
    activateWhenIdle: async () => { throw new Error("private path"); },
    captureForTurn: async () => { throw new Error("unused"); },
  } }).processPackageDeployments();
  expect(calls).toEqual(["STAGED", "WAITING_FOR_IDLE", "FAILED:STORAGE_FAILURE"]);
});

it("runner client exposes only structured HTTP failure details", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "do not expose", code: "INSPECTION_FAILED" }), {
    status: 422, headers: { "content-type": "application/json" },
  })));
  const state = createRunnerState(); state.registeredRunnerId = "runner-a";
  const api = createRunnerApi({ apiUrl: "https://api.invalid", runnerToken: "secret", heartbeatIntervalMs: 1,
    runnerIdFile: "/unused", runnerState: state });
  await expect(api.listPackageDeployments()).rejects.toMatchObject({ status: 422, code: "INSPECTION_FAILED" });
  await expect(api.listPackageDeployments()).rejects.toSatisfy(error => {
    expect(error).toBeInstanceOf(RunnerApiHttpError);
    expect(error.message).not.toContain("do not expose");
    return true;
  });
});

it("runner client preserves status without accepting malformed error bodies", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not-json-secret", { status: 422 })));
  const state = createRunnerState(); state.registeredRunnerId = "runner-a";
  const api = createRunnerApi({ apiUrl: "https://api.invalid", runnerToken: "secret", heartbeatIntervalMs: 1,
    runnerIdFile: "/unused", runnerState: state });
  await expect(api.listPackageDeployments()).rejects.toMatchObject({ status: 422, code: undefined });
  await expect(api.listPackageDeployments()).rejects.toSatisfy(error => {
    expect(error).toBeInstanceOf(RunnerApiHttpError);
    expect(error.message).not.toContain("not-json-secret");
    return true;
  });
});

it("runner client uses its injected transport for production routes", async () => {
  const requests: string[] = [];
  const state = createRunnerState(); state.registeredRunnerId = "runner-a";
  const api = createRunnerApi({ apiUrl: "https://api.invalid", runnerToken: "secret", heartbeatIntervalMs: 1,
    runnerIdFile: "/unused", runnerState: state, fetch: async (url: string | URL | Request) => {
      requests.push(String(url));
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    } });
  await api.listPackageDeployments();
  expect(requests).toEqual(["https://api.invalid/api/runners/runner-a/package-deployments"]);
});

it("runner client uses the four exact routes and keeps attempt tokens in the dedicated header", async () => {
  const { artifact } = fixture();
  const requests: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    requests.push({ url, init });
    const path = new URL(url).pathname;
    const payload = path.endsWith("package-deployments") ? [] : path.endsWith("claim")
      ? { deploymentId: "deploy-a", attemptToken: "x".repeat(43), leaseExpiresAt: 1 }
      : path.endsWith("artifact") ? artifact : { deploymentId: "deploy-a", state: "STAGED", revision: 2 };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }));
  const state = createRunnerState(); state.registeredRunnerId = "runner-a";
  const api = createRunnerApi({ apiUrl: "https://api.invalid", runnerToken: "secret", heartbeatIntervalMs: 1,
    runnerIdFile: "/unused", runnerState: state });
  await api.listPackageDeployments();
  await api.claimPackageDeployment("deploy-a");
  await api.getPackageArtifact("deploy-a", "x".repeat(43));
  await api.reportPackageDeployment("deploy-a", "x".repeat(43), { state: "STAGED", generation: "generation-a" });
  expect(requests.map(request => [new URL(request.url).pathname, request.init.method ?? "GET"])).toEqual([
    ["/api/runners/runner-a/package-deployments", "GET"],
    ["/api/runner-package-deployments/deploy-a/claim", "POST"],
    ["/api/runner-package-deployments/deploy-a/artifact", "GET"],
    ["/api/runner-package-deployments/deploy-a/report", "POST"],
  ]);
  for (const request of requests.slice(1)) {
    const headers = new Headers(request.init.headers);
    expect(headers.get("x-orgops-runner-id")).toBe("runner-a");
  }
  expect(new Headers(requests[2]!.init.headers).get("x-orgops-deployment-attempt-token")).toBe("x".repeat(43));
  expect(requests[2]!.url).not.toContain("attempt");
});

it("semantic digest is deterministic and sensitive to ordered package identities", () => {
  const { artifact } = fixture();
  expect(computeArtifactSemanticDigest(artifact)).toBe(`sha256:${createHash("sha256").update(JSON.stringify({
    deploymentId: "deploy-a", agentId: "agent-a", generation: "generation-a", packages: artifact.packages,
  })).digest("hex")}`);
});

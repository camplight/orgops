import { migrate, openDb, type OrgOpsDb } from "@orgops/db";
import type {
  AuthenticatedHuman,
  CatalogAuthorityCommand,
  GrantSubject,
  GrantView,
  HumanAdmin,
  PackageKind,
  PackageManifest,
  PackageReleaseView,
  RunnerContext,
  VerifiedArtifactEnvelope,
} from "@orgops/schemas";

const commit = "a".repeat(40);
const digest = `sha256:${"a".repeat(64)}`;

function manifest(kind: PackageKind): PackageManifest {
  const base = {
    formatVersion: 1 as const,
    name: kind === "skill" ? "demo-skill" : kind === "native-agent" ? "demo-native" : "demo-wrapped",
    version: "1.0.0",
    description: "Deterministic Source Library fixture.",
    author: "OrgOps",
    license: "MIT",
    compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux" as const], tools: [] },
    secrets: [],
    dependencies: [],
    files: [],
    executables: [],
    digest,
  };
  if (kind === "skill") return { ...base, kind, skill: { entrypoint: "SKILL.md" } };
  if (kind === "native-agent") return {
    ...base,
    kind,
    native: {
      mode: "RLM_REPL",
      systemInstructions: "Use the fixture safely.",
      runtime: {},
      alwaysPreloadedSkills: [],
    },
  };
  return {
    ...base,
    kind,
    wrapped: {
      kind: "fixture",
      harness: "command",
      sidecars: [],
      runtime: { command: "fixture-runtime" },
      session: { scope: "per-agent" },
      resourceWiring: "none",
    },
  };
}

export function openCatalogFixture(): { db: OrgOpsDb; close(): void } {
  const db = openDb(":memory:");
  migrate(db);
  db.exec(`
    INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
      VALUES ('human-a','human-a','fixture',0,1,1,1);
    INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at)
      VALUES ('runner-a','Runner A','{}',1,1,1);
    INSERT INTO models (id,provider,model_name,enabled,defaults_json,created_at)
      VALUES ('model-a','fixture','fixture',1,'{}',1);
    INSERT INTO agents (id,name,model_id,soul_path,workspace_path,assigned_runner_id,created_at,updated_at)
      VALUES ('agent-a','agent-a','model-a','soul','workspace','runner-a',1,1);
  `);
  return { db, close: () => db.close() };
}

export function adminActor(id = "human-a"): HumanAdmin {
  return { kind: "HUMAN_ADMIN", id };
}

export function humanActor(id = "human-a"): AuthenticatedHuman {
  return { kind: "AUTHENTICATED_HUMAN", id };
}

export function runnerActor(id: string): RunnerContext {
  return { runnerId: id };
}

export function sourceCommand(): CatalogAuthorityCommand {
  return {
    kind: "source.create",
    source: {
      sourceId: "source-team",
      displayName: "Team packages",
      repository: { url: "https://github.com/example/team-packages" },
      ref: "main",
      enabled: true,
      allowPackages: false,
    },
  };
}

export function approvedRelease(kind: PackageKind = "skill"): PackageReleaseView {
  const packageReleaseId = kind === "skill" ? "release-skill" : kind === "native-agent" ? "release-native-rlm" : "release-wrapped";
  const packageManifest = manifest(kind);
  return {
    packageReleaseId,
    authoritySourceId: "source-team",
    contentSourceId: "source-team",
    kind,
    name: packageManifest.name,
    version: packageManifest.version,
    digest,
    catalogCommit: commit,
    packageCommit: commit,
    packagePath: kind === "skill" ? "skills/demo-skill" : kind === "native-agent" ? "agents/demo-native" : "agents/demo-wrapped",
    manifest: packageManifest,
    executionPreview: { apiEventShapes: [], runnerScripts: [], wrappedCommands: [], externalSources: [] },
    warnings: [],
    files: [],
    reviewState: "APPROVED",
    reviewDigest: digest,
    reviewer: { humanId: "human-a", reviewedAt: 1 },
    installationState: "INSTALLED",
    apiActivation: { approvalState: "NOT_REQUIRED", runtimeState: "INACTIVE", revision: 1, failureCode: null },
    revision: 1,
  };
}

export function grantFor(subject: GrantSubject): GrantView {
  return {
    grantId: subject.kind === "HUMAN" ? "grant-human-a" : "grant-organization",
    releaseId: "release-skill",
    subject,
    revision: 1,
    revokedAt: null,
  };
}

export function catalogArtifact(releaseId: string): VerifiedArtifactEnvelope {
  const release = [approvedRelease("skill"), approvedRelease("native-agent"), approvedRelease("wrapped-agent")]
    .find(candidate => candidate.packageReleaseId === releaseId) ?? approvedRelease("skill");
  return {
    deploymentId: "deployment-a",
    agentId: "agent-a",
    generation: "generation-a",
    release: {
      packageReleaseId: release.packageReleaseId,
      authoritySourceId: release.authoritySourceId,
      contentSourceId: release.contentSourceId,
      kind: release.kind,
      name: release.name,
      version: release.version,
      catalogCommit: release.catalogCommit,
      packageCommit: release.packageCommit,
      packagePath: release.packagePath,
      digest: release.digest,
    },
    manifest: release.manifest,
    dependencies: [],
    packages: [{
      release: {
        packageReleaseId: release.packageReleaseId,
        authoritySourceId: release.authoritySourceId,
        contentSourceId: release.contentSourceId,
        kind: release.kind,
        name: release.name,
        version: release.version,
        catalogCommit: release.catalogCommit,
        packageCommit: release.packageCommit,
        packagePath: release.packagePath,
        digest: release.digest,
      },
      manifest: release.manifest,
      direct: true,
      namespace: `packages/000-${release.name}`,
    }],
    semanticDigest: digest,
    files: [],
  };
}

export function seedLegacy032(db: OrgOpsDb): void {
  db.exec(`
    INSERT INTO catalog_sources
      (source_id,canonical_url,ssh_user,repository_identity,enabled,allow_packages,revision,removed_at,created_at,updated_at)
      VALUES ('legacy-source','https://github.com/example/team-packages',NULL,'legacy-source-identity',1,1,1,NULL,1,1);
    INSERT INTO catalogs
      (catalog_id,source_id,display_name,ref,enabled,revision,removed_at,created_at,updated_at)
      VALUES ('source-team','legacy-source','Team packages','main',1,1,NULL,1,1);
  `);
}

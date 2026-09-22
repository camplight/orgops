import type { Context, Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  CatalogLibraryErrorCodeSchema,
  DigestSchema,
  PackageNameSchema,
  PackageReleaseIdSchema,
  ReadCredentialSetSchema,
  RevisionRequestSchema,
  SourceCreateSchema,
  SourceIdSchema,
  SourcePatchSchema,
  VersionSchema,
  type ApiExecutionCoordinator,
  type AuthenticatedHuman,
  type CatalogAuthority,
  type CatalogAuthorityQuery,
  type CatalogConsumption,
  type CatalogLibraryErrorCode,
  type HumanAdmin,
  type PackageInstallation,
  type ReviewAction,
  type RolloutCoordinator,
  ActivationPlanCommandSchema,
  ConfirmActivationCommandSchema,
  CancelRolloutCommandSchema,
  RetryFailedRolloutCommandSchema,
  RolloutViewSchema,
  LibraryPackageDetailSchema,
  ManageableAgentSchema,
  TemplateOptionsSchema,
  UserTemplateInstantiationResultSchema,
  SecretBindingMutationRequestSchema,
  SecretBindingMutationResultSchema,
  type LibraryPackageDetail,
  type ManageableAgent,
  type TemplateOptions,
} from "@orgops/schemas";
import { CatalogAuthorityError } from "../catalog-library/authority";
import { ApiExecutionError } from "../catalog-library/activation";
import { CatalogConsumptionError } from "../catalog-library/consumption";
import { catalogGrantId } from "../catalog-library/grant-identity";
import type { TemplateInstantiationResult } from "../unified-skills/template-provisioner";
import { SecretBindingMutationError, type SecretBindingMutation } from "../catalog-library/secret-binding";
import type { AgentSkillManagement } from "../unified-skills/management";
import type { AgentProvisioning } from "../unified-skills/provisioning";

const MAX_CATALOG_BODY_BYTES = 16 * 1024;
const ReleaseReviewRequestSchema = z.object({
  expectedRevision: z.number().finite().int().min(1).max(2147483647),
  digest: DigestSchema,
  reviewDigest: DigestSchema,
}).strict();
const ApiExecutionApprovalRequestSchema = z.object({
  expectedRevision: z.number().finite().int().min(1).max(2147483647),
  digest: DigestSchema,
}).strict();
const ApiExecutionRevisionRequestSchema = z.object({
  expectedRevision: z.number().finite().int().min(1).max(2147483647),
}).strict();
const InstallExactRequestSchema = z.object({
  dependencyReleaseIds: z.array(PackageReleaseIdSchema).max(255)
    .refine(ids => new Set(ids).size === ids.length),
}).strict();
const GrantPutRequestSchema = z.object({
  expectedRevision: z.number().finite().int().min(0).max(2147483647),
}).strict();
const HumanIdSchema = z.string().min(1).max(200);
const LibraryPackageSchema = z.object({
  packageReleaseId: PackageReleaseIdSchema,
  kind: z.enum(["skill", "native-agent", "wrapped-agent"]),
  name: PackageNameSchema,
  version: VersionSchema,
  digest: DigestSchema,
}).strict();
const LibraryPackagesSchema = z.object({
  packages: z.array(LibraryPackageSchema).max(100),
  emptyReason: z.enum(["NO_GRANTS", "NOT_INSTALLED", "NO_COMPATIBLE_RELEASES"]).optional(),
}).strict();
const AssignmentRequestSchema = z.object({
  expectedAgentRevision: z.number().finite().int().min(1).max(2147483647),
  expectedAssignmentRevision: z.number().finite().int().min(0).max(2147483647),
  preload: z.boolean(),
}).strict();
const TemplateInstantiationRequestSchema = z.object({
  name: z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
  runnerId: z.string().min(1).max(200),
  workspacePath: z.string().min(1).max(4096),
  modelId: z.string().min(1).max(200),
  secretBindings: z.array(z.object({
    requirementName: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    secretId: z.string().min(1).max(200),
  }).strict()).max(64).refine(bindings => new Set(bindings.map(binding => binding.requirementName)).size === bindings.length),
}).strict();

export type LibraryPackage = z.infer<typeof LibraryPackageSchema>;
export type LibraryEmptyReason = "NO_GRANTS" | "NOT_INSTALLED" | "NO_COMPATIBLE_RELEASES";
export type CatalogLibraryReader = {
  list(actor: AuthenticatedHuman): { packages: readonly LibraryPackage[]; emptyReason?: LibraryEmptyReason };
  detail(actor: AuthenticatedHuman, packageReleaseId: string): LibraryPackage | undefined;
  safeDetail?(actor: AuthenticatedHuman, packageReleaseId: string): LibraryPackageDetail | undefined;
  manageableAgents?(actor: AuthenticatedHuman, packageReleaseId: string): readonly ManageableAgent[] | undefined;
  templateOptions?(actor: AuthenticatedHuman, packageReleaseId: string): TemplateOptions | undefined;
};

const errorMessages: Record<CatalogLibraryErrorCode, string> = {
  INVALID_REQUEST: "Invalid catalog library request",
  PAYLOAD_TOO_LARGE: "Catalog library request too large",
  FORBIDDEN: "Administrator access required",
  NOT_FOUND: "Catalog library resource not found",
  REMOVED: "Catalog library resource removed",
  REVISION_CONFLICT: "Catalog library changed; reload metadata",
  STATE_CONFLICT: "Catalog library operation conflicts with current state",
  IDENTITY_CONFLICT: "Catalog release identity already reserved",
  SOURCE_NOT_ALLOWED: "Package source is not enabled for this operation",
  SOURCE_UNAVAILABLE: "Package source is unavailable",
  RELEASE_NOT_APPROVED: "Package release is not approved",
  GRANT_REQUIRED: "A current grant is required",
  INSTALLATION_REQUIRED: "Package release is not installed",
  API_ACTIVATION_REQUIRED: "API execution approval is required",
  REQUIREMENTS_UNSATISFIED: "Agent requirements are not satisfied",
  OPERATION_IN_PROGRESS: "Catalog operation is already in progress",
  DEPLOYMENT_SUPERSEDED: "Runner deployment was superseded",
  INSPECTION_FAILED: "Package inspection failed; last-known-good content is unchanged",
  STORAGE_FAILURE: "Catalog library operation failed",
  SYNC_FAILED: "Source synchronization failed",
  CATALOG_RESOURCE_RETIRED: "Catalog resource retired; use Source Library",
};

const errorStatuses: Record<CatalogLibraryErrorCode, number> = {
  INVALID_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REMOVED: 409,
  REVISION_CONFLICT: 409,
  STATE_CONFLICT: 409,
  IDENTITY_CONFLICT: 409,
  SOURCE_NOT_ALLOWED: 403,
  SOURCE_UNAVAILABLE: 503,
  RELEASE_NOT_APPROVED: 409,
  GRANT_REQUIRED: 403,
  INSTALLATION_REQUIRED: 409,
  API_ACTIVATION_REQUIRED: 409,
  REQUIREMENTS_UNSATISFIED: 409,
  OPERATION_IN_PROGRESS: 409,
  DEPLOYMENT_SUPERSEDED: 409,
  INSPECTION_FAILED: 422,
  STORAGE_FAILURE: 500,
  SYNC_FAILED: 502,
  CATALOG_RESOURCE_RETIRED: 410,
};

type StrictSchema<T> = {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
};

type StrictBodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "INVALID_REQUEST" | "PAYLOAD_TOO_LARGE" };

type CatalogRouteUser = {
  id?: string;
  runnerScope?: unknown;
};

export type CatalogSourceRouteDeps = {
  authority: CatalogAuthority;
  installation?: PackageInstallation;
  apiExecution?: ApiExecutionCoordinator;
  requireAuth: MiddlewareHandler;
  requireAdmin: MiddlewareHandler;
  resolveLibraryActor?: (principal: CatalogRouteUser) => AuthenticatedHuman | undefined;
  library?: CatalogLibraryReader;
  secretBinding?: SecretBindingMutation;
  consumption?: CatalogConsumption;
  management?: AgentSkillManagement;
  provisioning?: AgentProvisioning;
  issueSecretReference?: (actor: AuthenticatedHuman, secretId: string) => string;
  rollout?: RolloutCoordinator;
  resolveAgentId?: (name: string) => string | undefined;
};

async function readStrictBody<T>(c: Context, schema: StrictSchema<T>): Promise<StrictBodyResult<T>> {
  const mediaType = c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") return { ok: false, code: "INVALID_REQUEST" };

  const stream = c.req.raw.body;
  if (!stream) return { ok: false, code: "INVALID_REQUEST" };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CATALOG_BODY_BYTES) {
        try { await reader.cancel(); } catch { /* Size is authoritative; cancellation is best-effort cleanup. */ }
        return { ok: false, code: "PAYLOAD_TOO_LARGE" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, code: "INVALID_REQUEST" };
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let input: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    input = JSON.parse(text);
  } catch {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  const parsed = schema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: "INVALID_REQUEST" };
}

function catalogError(c: Context, code: CatalogLibraryErrorCode) {
  return c.json({ error: errorMessages[code], code }, errorStatuses[code] as never);
}

function actorFromContext(c: Context<any>): HumanAdmin {
  return { kind: "HUMAN_ADMIN", id: (c.get("user") as CatalogRouteUser).id! };
}

function sourceIdFromContext(c: Context): { ok: true; value: string } | { ok: false } {
  const parsed = SourceIdSchema.safeParse(c.req.param("sourceId"));
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

function releaseIdFromContext(c: Context): { ok: true; value: string } | { ok: false } {
  const parsed = PackageReleaseIdSchema.safeParse(c.req.param("packageReleaseId"));
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

async function translated<T>(c: Context, operation: () => Promise<T>, successStatus = 200) {
  try {
    return c.json(await operation(), successStatus as never);
  } catch (error) {
    return catalogError(c, error instanceof CatalogAuthorityError ? error.code : "STORAGE_FAILURE");
  }
}

export function registerCatalogSourceRoutes(
  app: Hono<any>,
  { authority, installation, apiExecution, requireAuth, requireAdmin, resolveLibraryActor, library, provisioning, issueSecretReference, secretBinding, consumption, management, rollout, resolveAgentId }: CatalogSourceRouteDeps,
) {
  const protectedRoute = [requireAuth, requireAdmin] as const;
  const noStore: MiddlewareHandler = async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  };
  app.use("/api/catalog-sources", noStore);
  app.use("/api/catalog-sources/*", noStore);
  app.use("/api/catalog-releases", noStore);
  app.use("/api/catalog-releases/*", noStore);
  app.use("/api/library/packages", noStore);
  app.use("/api/library/packages/*", noStore);
  app.use("/api/library/templates", noStore);
  app.use("/api/library/templates/*", noStore);
  app.use("/api/library/agents/*", noStore);
  app.use("/api/agents/:name/catalog-skills/*", noStore);
  app.use("/api/catalog-rollouts", noStore);
  app.use("/api/catalog-rollouts/*", noStore);

  const requireLibraryHuman: MiddlewareHandler = async (c, next) => {
    const actor = resolveLibraryActor?.(c.get("user") as CatalogRouteUser);
    if (!actor) return c.json({ error: "Authenticated human access required" }, 403);
    c.set("libraryActor", actor);
    await next();
  };
  const libraryActor = (c: Context<any>) => c.get("libraryActor") as AuthenticatedHuman;
  const hasQuery = (c: Context) => new URL(c.req.url).search.length > 0;
  const rolloutError = (c: Context, error: unknown) => {
    const candidate = error instanceof Error && "code" in error ? (error as { code?: unknown }).code : undefined;
    const parsed = CatalogLibraryErrorCodeSchema.safeParse(candidate);
    return catalogError(c, parsed.success ? parsed.data : "STORAGE_FAILURE");
  };
  const rolloutHuman = [requireAuth, requireLibraryHuman] as const;

  app.post("/api/catalog-rollouts/plan", ...rolloutHuman, async c => {
    if (hasQuery(c) || !rollout) return catalogError(c, rollout ? "INVALID_REQUEST" : "STORAGE_FAILURE");
    const body = await readStrictBody(c, ActivationPlanCommandSchema);
    if (!body.ok) return catalogError(c, body.code);
    try { return c.json(await rollout.plan(body.value, libraryActor(c))); } catch (error) { return rolloutError(c, error); }
  });
  app.post("/api/catalog-rollouts", ...rolloutHuman, async c => {
    if (hasQuery(c) || !rollout) return catalogError(c, rollout ? "INVALID_REQUEST" : "STORAGE_FAILURE");
    const body = await readStrictBody(c, ConfirmActivationCommandSchema);
    if (!body.ok) return catalogError(c, body.code);
    try { return c.json(await rollout.confirm(body.value, libraryActor(c)), 201); } catch (error) { return rolloutError(c, error); }
  });
  app.get("/api/catalog-rollouts/:rolloutId", ...rolloutHuman, async c => {
    if (hasQuery(c) || !rollout || c.req.raw.body) return catalogError(c, rollout ? "INVALID_REQUEST" : "STORAGE_FAILURE");
    const rolloutId = c.req.param("rolloutId");
    if (!/^[a-z0-9][a-z0-9._:-]{0,199}$/.test(rolloutId)) return catalogError(c, "NOT_FOUND");
    try { return c.json(RolloutViewSchema.parse(await rollout.getRollout(rolloutId, libraryActor(c)))); } catch (error) { return rolloutError(c, error); }
  });
  app.post("/api/catalog-rollouts/:rolloutId/cancel", ...rolloutHuman, async c => {
    if (hasQuery(c) || !rollout) return catalogError(c, rollout ? "INVALID_REQUEST" : "STORAGE_FAILURE");
    const body = await readStrictBody(c, CancelRolloutCommandSchema);
    if (!body.ok) return catalogError(c, body.code);
    if (body.value.rolloutId !== c.req.param("rolloutId")) return catalogError(c, "INVALID_REQUEST");
    try { return c.json(await rollout.cancel(body.value, libraryActor(c))); } catch (error) { return rolloutError(c, error); }
  });
  app.post("/api/catalog-rollouts/:rolloutId/retry-failed", ...rolloutHuman, async c => {
    if (hasQuery(c) || !rollout) return catalogError(c, rollout ? "INVALID_REQUEST" : "STORAGE_FAILURE");
    const body = await readStrictBody(c, RetryFailedRolloutCommandSchema);
    if (!body.ok) return catalogError(c, body.code);
    if (body.value.rolloutId !== c.req.param("rolloutId")) return catalogError(c, "INVALID_REQUEST");
    try { return c.json(await rollout.retryFailed(body.value, libraryActor(c))); } catch (error) { return rolloutError(c, error); }
  });

  app.get("/api/library/packages", requireAuth, requireLibraryHuman, c => {
    if (hasQuery(c)) return catalogError(c, "INVALID_REQUEST");
    if (!library) return catalogError(c, "STORAGE_FAILURE");
    try {
      const result = LibraryPackagesSchema.parse(library.list(libraryActor(c)));
      return c.json(result);
    } catch {
      return catalogError(c, "STORAGE_FAILURE");
    }
  });

  app.get("/api/library/packages/:packageReleaseId/manageable-agents", requireAuth, requireLibraryHuman, c => {
    if (hasQuery(c) || c.req.raw.body) return catalogError(c, "INVALID_REQUEST");
    const releaseId = releaseIdFromContext(c);
    if (!releaseId.ok || !library?.manageableAgents) return catalogError(c, "NOT_FOUND");
    try {
      const value = library.manageableAgents(libraryActor(c), releaseId.value);
      return value === undefined ? catalogError(c, "NOT_FOUND") : c.json(z.array(ManageableAgentSchema).max(256).parse(value));
    } catch { return catalogError(c, "NOT_FOUND"); }
  });

  app.get("/api/library/packages/:packageReleaseId/template-options", requireAuth, requireLibraryHuman, c => {
    if (hasQuery(c) || c.req.raw.body) return catalogError(c, "INVALID_REQUEST");
    const releaseId = releaseIdFromContext(c);
    if (!releaseId.ok || !library?.templateOptions) return catalogError(c, "NOT_FOUND");
    try {
      const value = library.templateOptions(libraryActor(c), releaseId.value);
      return value === undefined ? catalogError(c, "NOT_FOUND") : c.json(TemplateOptionsSchema.parse(value));
    } catch { return catalogError(c, "NOT_FOUND"); }
  });

  app.get("/api/library/packages/:packageReleaseId", requireAuth, requireLibraryHuman, c => {
    if (hasQuery(c) || c.req.raw.body) return catalogError(c, "INVALID_REQUEST");
    const releaseId = releaseIdFromContext(c);
    if (!releaseId.ok || !library) return catalogError(c, "NOT_FOUND");
    try {
      const safeDetail = library.safeDetail?.(libraryActor(c), releaseId.value);
      if (safeDetail !== undefined) return c.json(LibraryPackageDetailSchema.parse(safeDetail));
      const value = library.detail(libraryActor(c), releaseId.value);
      return value ? c.json({ package: LibraryPackageSchema.parse(value) }) : catalogError(c, "NOT_FOUND");
    } catch {
      return catalogError(c, "STORAGE_FAILURE");
    }
  });

  const registerAssignment = (method: "put" | "delete", kind: "assignment.enable" | "assignment.disable") => {
    app[method]("/api/agents/:name/catalog-skills/:packageReleaseId", requireAuth, requireLibraryHuman, async c => {
      if (hasQuery(c)) return catalogError(c, "INVALID_REQUEST");
      const releaseId = releaseIdFromContext(c);
      if (!releaseId.ok) return catalogError(c, "NOT_FOUND");
      const body = await readStrictBody(c, AssignmentRequestSchema);
      if (!body.ok) return catalogError(c, body.code);
      const agentId = resolveAgentId?.(c.req.param("name"));
      if (!agentId) return catalogError(c, "FORBIDDEN");
      if (!management && !consumption) return catalogError(c, "STORAGE_FAILURE");
      try {
        if (management) {
          const result = await management.executeLegacyCatalog({ kind: "CATALOG", operation: kind === "assignment.enable" ? "ENABLE" : "DISABLE", agentId, packageReleaseId: releaseId.value, preload: body.value.preload, expectedAgentRevision: body.value.expectedAgentRevision, expectedAssignmentRevision: body.value.expectedAssignmentRevision }, libraryActor(c));
          const ref = result.ref as { assignmentId?: string; desiredGeneration?: string; activeGeneration?: string | null };
          return c.json({ assignmentId: ref.assignmentId ?? releaseId.value, desiredState: result.desired === "ABSENT" ? "DISABLED" : result.desired, effectiveState: result.effective, deploymentState: result.deployment, activeGeneration: ref.activeGeneration ?? null, desiredGeneration: ref.desiredGeneration ?? "pending", revision: result.revision });
        }
        return c.json(await consumption!.assignSkill({ kind, agentId, releaseId: releaseId.value, ...body.value }, libraryActor(c)));
      } catch (error) {
        return catalogError(c, error instanceof CatalogConsumptionError ? error.code : error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) as CatalogLibraryErrorCode : "STORAGE_FAILURE");
      }
    });
  };
  registerAssignment("put", "assignment.enable");
  registerAssignment("delete", "assignment.disable");

  app.put("/api/library/agents/:agentId/requirements/:requirementName/secret-binding", requireAuth, requireLibraryHuman, async c => {
    if (hasQuery(c)) return catalogError(c, "INVALID_REQUEST");
    const agentId = c.req.param("agentId");
    const requirementName = c.req.param("requirementName");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(agentId) || !/^[A-Z][A-Z0-9_]{0,63}$/.test(requirementName)) return catalogError(c, "INVALID_REQUEST");
    const body = await readStrictBody(c, SecretBindingMutationRequestSchema);
    if (!body.ok) return catalogError(c, body.code);
    if (!secretBinding) return catalogError(c, "STORAGE_FAILURE");
    try {
      return c.json(SecretBindingMutationResultSchema.parse(await secretBinding.bind(agentId, requirementName, body.value, libraryActor(c))));
    } catch (error) {
      return catalogError(c, error instanceof SecretBindingMutationError ? error.code : "STORAGE_FAILURE");
    }
  });

  app.post("/api/library/templates/:packageReleaseId/instances", requireAuth, requireLibraryHuman, async c => {
    if (hasQuery(c)) return catalogError(c, "INVALID_REQUEST");
    const releaseId = releaseIdFromContext(c);
    if (!releaseId.ok) return catalogError(c, "NOT_FOUND");
    const body = await readStrictBody(c, TemplateInstantiationRequestSchema);
    if (!body.ok) return catalogError(c, body.code);
    const actor = libraryActor(c);
    if (!provisioning?.instantiateTemplate) return catalogError(c, "STORAGE_FAILURE");
    if (body.value.secretBindings.length > 0 && !issueSecretReference) return catalogError(c, "INVALID_REQUEST");
    try {
      const result = await provisioning.instantiateTemplate({
        packageReleaseId: releaseId.value,
        ownerHumanId: actor.id,
        ...body.value,
        secretBindings: body.value.secretBindings.map(binding => ({ requirementName: binding.requirementName, secretReferenceId: issueSecretReference ? issueSecretReference(actor, binding.secretId) : "" })),
      }, actor) as TemplateInstantiationResult;
      const safeResult = {
        agent: {
          id: result.agent.id, name: result.agent.name, visibility: result.agent.visibility,
          assignedRunnerId: result.agent.assignedRunnerId, modelId: result.agent.modelId, mode: result.agent.mode,
          desiredState: result.agent.desiredState, runtimeState: result.agent.runtimeState, channelIds: [],
        },
        origin: { packageReleaseId: result.origin.packageReleaseId, mode: result.origin.mode, actorKind: result.origin.actorKind, createdAt: result.origin.createdAt },
        requirements: result.requirements,
      };
      return c.json(UserTemplateInstantiationResultSchema.parse(safeResult), 201);
    } catch (error) {
      const candidate = error instanceof Error && "code" in error ? (error as { code?: unknown }).code : undefined;
      const parsedCode = CatalogLibraryErrorCodeSchema.safeParse(candidate);
      const finalCode = parsedCode.success ? parsedCode.data : "STORAGE_FAILURE";
      return catalogError(c, finalCode === "FORBIDDEN" && body.value.secretBindings.length > 0 ? "INVALID_REQUEST" : finalCode);
    }
  });

  app.post("/api/catalog-sources", ...protectedRoute, async c => {
    const body = await readStrictBody(c, SourceCreateSchema);
    if (!body.ok) return catalogError(c, body.code);
    return translated(c, () => authority.execute(
      { kind: "source.create", source: body.value },
      actorFromContext(c),
    ), 201);
  });

  app.patch("/api/catalog-sources/:sourceId", ...protectedRoute, async c => {
    const sourceId = sourceIdFromContext(c);
    if (!sourceId.ok) return catalogError(c, "INVALID_REQUEST");
    const body = await readStrictBody(c, SourcePatchSchema);
    if (!body.ok) return catalogError(c, body.code);
    return translated(c, () => authority.execute(
      { kind: "source.patch", sourceId: sourceId.value, patch: body.value },
      actorFromContext(c),
    ));
  });

  app.delete("/api/catalog-sources/:sourceId", ...protectedRoute, async c => {
    const sourceId = sourceIdFromContext(c);
    if (!sourceId.ok) return catalogError(c, "INVALID_REQUEST");
    const body = await readStrictBody(c, RevisionRequestSchema);
    if (!body.ok) return catalogError(c, body.code);
    return translated(c, () => authority.execute(
      { kind: "source.remove", sourceId: sourceId.value, expectedRevision: body.value.expectedRevision },
      actorFromContext(c),
    ));
  });

  app.post("/api/catalog-sources/:sourceId/restore", ...protectedRoute, async c => {
    const sourceId = sourceIdFromContext(c);
    if (!sourceId.ok) return catalogError(c, "INVALID_REQUEST");
    const body = await readStrictBody(c, RevisionRequestSchema);
    if (!body.ok) return catalogError(c, body.code);
    return translated(c, () => authority.execute(
      { kind: "source.restore", sourceId: sourceId.value, expectedRevision: body.value.expectedRevision },
      actorFromContext(c),
    ));
  });

  app.put("/api/catalog-sources/:sourceId/read-credential", ...protectedRoute, async c => {
    const sourceId = sourceIdFromContext(c);
    if (!sourceId.ok) return catalogError(c, "INVALID_REQUEST");
    const body = await readStrictBody(c, ReadCredentialSetSchema);
    if (!body.ok) return catalogError(c, body.code);
    return translated(c, () => authority.execute({
      kind: "source.credential.put",
      sourceId: sourceId.value,
      expectedRevision: body.value.expectedRevision,
      username: body.value.username,
      password: body.value.password,
    }, actorFromContext(c)));
  });

  app.delete("/api/catalog-sources/:sourceId/read-credential", ...protectedRoute, async c => {
    const sourceId = sourceIdFromContext(c);
    if (!sourceId.ok) return catalogError(c, "INVALID_REQUEST");
    const body = await readStrictBody(c, RevisionRequestSchema);
    if (!body.ok) return catalogError(c, body.code);
    return translated(c, () => authority.execute({
      kind: "source.credential.delete",
      sourceId: sourceId.value,
      expectedRevision: body.value.expectedRevision,
    }, actorFromContext(c)));
  });

  app.post("/api/catalog-sources/:sourceId/sync", ...protectedRoute, async c => {
    const sourceId = sourceIdFromContext(c);
    if (!sourceId.ok) return catalogError(c, "INVALID_REQUEST");
    const body = await readStrictBody(c, RevisionRequestSchema);
    if (!body.ok) return catalogError(c, body.code);
    return translated(c, () => authority.execute({
      kind: "source.sync",
      sourceId: sourceId.value,
      expectedRevision: body.value.expectedRevision,
    }, actorFromContext(c)));
  });

  const query = (queryInput: CatalogAuthorityQuery, c: Context<any>) =>
    translated(c, () => authority.query(queryInput, actorFromContext(c)));

  app.get("/api/catalog-sources/:sourceId/sync-attempts", ...protectedRoute, async c => {
    const sourceId = sourceIdFromContext(c);
    return sourceId.ok
      ? query({ kind: "source.sync-attempts", sourceId: sourceId.value }, c)
      : catalogError(c, "INVALID_REQUEST");
  });

  app.get("/api/catalog-sources/:sourceId/snapshots", ...protectedRoute, async c => {
    const sourceId = sourceIdFromContext(c);
    return sourceId.ok
      ? query({ kind: "source.snapshots", sourceId: sourceId.value }, c)
      : catalogError(c, "INVALID_REQUEST");
  });

  app.get("/api/catalog-sources", ...protectedRoute, c => query({ kind: "source.list" }, c));

  app.get("/api/catalog-sources/:sourceId", ...protectedRoute, async c => {
    const sourceId = sourceIdFromContext(c);
    return sourceId.ok
      ? query({ kind: "source.detail", sourceId: sourceId.value }, c)
      : catalogError(c, "INVALID_REQUEST");
  });

  const registerReviewAction = (pathAction: string, action: ReviewAction) => {
    app.post(`/api/catalog-releases/:packageReleaseId/${pathAction}`, ...protectedRoute, async c => {
      const releaseId = releaseIdFromContext(c);
      if (!releaseId.ok) return catalogError(c, "INVALID_REQUEST");
      const body = await readStrictBody(c, ReleaseReviewRequestSchema);
      if (!body.ok) return catalogError(c, body.code);
      return translated(c, () => authority.execute({
        kind: "release.review",
        releaseId: releaseId.value,
        action,
        expectedRevision: body.value.expectedRevision,
        digest: body.value.digest,
        reviewDigest: body.value.reviewDigest,
      }, actorFromContext(c)));
    });
  };
  registerReviewAction("approve", "APPROVE");
  registerReviewAction("reject", "REJECT");
  registerReviewAction("withdraw", "WITHDRAW");
  registerReviewAction("reopen", "REOPEN");

  if (apiExecution) {
    const activationRoute = (
      action: "approve" | "activate" | "deactivate",
      schema: StrictSchema<{ expectedRevision: number; digest?: string }>,
    ) => {
      app.post(`/api/catalog-releases/:packageReleaseId/api-execution/${action}`, ...protectedRoute, async c => {
        if (hasQuery(c)) return catalogError(c, "INVALID_REQUEST");
        const releaseId = releaseIdFromContext(c);
        if (!releaseId.ok) return catalogError(c, "INVALID_REQUEST");
        const body = await readStrictBody(c, schema);
        if (!body.ok) return catalogError(c, body.code);
        try {
          const actor = actorFromContext(c);
          const value = action === "approve"
            ? await apiExecution.approveApiExecution({ releaseId: releaseId.value, expectedRevision: body.value.expectedRevision, digest: body.value.digest! }, actor)
            : action === "activate"
              ? await apiExecution.activateApiExecution({ releaseId: releaseId.value, expectedRevision: body.value.expectedRevision }, actor)
              : await apiExecution.deactivateApiExecution({ releaseId: releaseId.value, expectedRevision: body.value.expectedRevision }, actor);
          return c.json(value);
        } catch (error) {
          return catalogError(c, error instanceof ApiExecutionError ? error.code : "STORAGE_FAILURE");
        }
      });
    };
    activationRoute("approve", ApiExecutionApprovalRequestSchema);
    activationRoute("activate", ApiExecutionRevisionRequestSchema);
    activationRoute("deactivate", ApiExecutionRevisionRequestSchema);
  }

  if (installation) app.post("/api/catalog-releases/:packageReleaseId/install", ...protectedRoute, async c => {
    const releaseId = releaseIdFromContext(c);
    if (!releaseId.ok) return catalogError(c, "INVALID_REQUEST");
    const body = await readStrictBody(c, InstallExactRequestSchema);
    if (!body.ok) return catalogError(c, body.code);
    try {
      const result = await installation.installExact({
        packageReleaseId: releaseId.value,
        dependencyReleaseIds: body.value.dependencyReleaseIds,
      }, actorFromContext(c));
      return result.ok ? c.json(result) : catalogError(c, result.code);
    } catch {
      return catalogError(c, "STORAGE_FAILURE");
    }
  });

  app.get("/api/catalog-releases/:packageReleaseId/grants", ...protectedRoute, async c => {
    const releaseId = releaseIdFromContext(c);
    return releaseId.ok
      ? query({ kind: "release.grants", packageReleaseId: releaseId.value }, c)
      : catalogError(c, "INVALID_REQUEST");
  });

  app.put("/api/catalog-releases/:packageReleaseId/grants/organization", ...protectedRoute, async c => {
    const releaseId = releaseIdFromContext(c);
    if (!releaseId.ok) return catalogError(c, "INVALID_REQUEST");
    const body = await readStrictBody(c, GrantPutRequestSchema);
    if (!body.ok) return catalogError(c, body.code);
    return translated(c, () => authority.execute({
      kind: "grant.organization", releaseId: releaseId.value, expectedRevision: body.value.expectedRevision,
    }, actorFromContext(c)));
  });

  app.delete("/api/catalog-releases/:packageReleaseId/grants/organization", ...protectedRoute, async c => {
    const releaseId = releaseIdFromContext(c);
    if (!releaseId.ok) return catalogError(c, "INVALID_REQUEST");
    const body = await readStrictBody(c, RevisionRequestSchema);
    if (!body.ok) return catalogError(c, body.code);
    return translated(c, () => authority.execute({
      kind: "grant.revoke",
      grantId: catalogGrantId(releaseId.value, "ORGANIZATION"),
      expectedRevision: body.value.expectedRevision,
    }, actorFromContext(c)));
  });

  const humanGrantParams = (c: Context) => {
    const releaseId = releaseIdFromContext(c);
    const humanId = HumanIdSchema.safeParse(c.req.param("humanId"));
    return releaseId.ok && humanId.success ? { releaseId: releaseId.value, humanId: humanId.data } : undefined;
  };

  app.put("/api/catalog-releases/:packageReleaseId/grants/humans/:humanId", ...protectedRoute, async c => {
    const params = humanGrantParams(c);
    if (!params) return catalogError(c, "INVALID_REQUEST");
    const body = await readStrictBody(c, GrantPutRequestSchema);
    if (!body.ok) return catalogError(c, body.code);
    return translated(c, () => authority.execute({
      kind: "grant.human", releaseId: params.releaseId, humanId: params.humanId, expectedRevision: body.value.expectedRevision,
    }, actorFromContext(c)));
  });

  app.delete("/api/catalog-releases/:packageReleaseId/grants/humans/:humanId", ...protectedRoute, async c => {
    const params = humanGrantParams(c);
    if (!params) return catalogError(c, "INVALID_REQUEST");
    const body = await readStrictBody(c, RevisionRequestSchema);
    if (!body.ok) return catalogError(c, body.code);
    return translated(c, () => authority.execute({
      kind: "grant.revoke",
      grantId: catalogGrantId(params.releaseId, "HUMAN", params.humanId),
      expectedRevision: body.value.expectedRevision,
    }, actorFromContext(c)));
  });

  app.get("/api/catalog-releases", ...protectedRoute, c => query({ kind: "release.list" }, c));
  app.get("/api/catalog-releases/:packageReleaseId", ...protectedRoute, async c => {
    const releaseId = releaseIdFromContext(c);
    return releaseId.ok
      ? query({ kind: "release.detail", packageReleaseId: releaseId.value }, c)
      : catalogError(c, "INVALID_REQUEST");
  });
}

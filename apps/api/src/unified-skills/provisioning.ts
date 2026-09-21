import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { OrgOpsDb } from "@orgops/db";
import { decryptSecret } from "@orgops/crypto";
import {
  AgentCreationSchema,
  AgentProvisioningPreflightSchema,
  CatalogLibraryErrorCodeSchema,
  AgentProvisioningReceiptSchema,
  PackageManifestSchema,
  OpaqueSecretReferenceSchema,
  ProvisionAgentSchema,
  type AgentCreation,
  type AgentProvisioningPreflight,
  type AgentProvisioningReceipt,
  type InventoryActor,
  type ProvisionAgentHttpInput,
  type SealedSecretBinding,
  type SkillCommand,
  type SkillRef,
} from "@orgops/schemas";
import type { AgentSkillManagement } from "./management";

export type SecretReferenceValidation = "VALID" | "MISSING" | "INVALID";
export type SecretReferenceResolver = Readonly<{
  issue(actor: InventoryActor, secretId: string, purpose?: string): string;
  validate(actor: InventoryActor, handle: string, purpose?: string): SecretReferenceValidation;
  bindForWrite(tx: OrgOpsDb, actor: InventoryActor, agentId: string, bindings: readonly SealedSecretBinding[]): void;
}>;

export class AgentProvisioningError extends Error {
  constructor(readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new AgentProvisioningError(code); };

export type TemplateProvisioningBridge = Readonly<{
  instantiateTemplate(input: unknown, actor: InventoryActor): Promise<unknown>;
}>;
export type AgentProvisioningDeps = Readonly<{
  db: OrgOpsDb;
  management?: AgentSkillManagement;
  secretReferenceResolver?: SecretReferenceResolver;
  requireLiveHuman?: (tx: OrgOpsDb, actor: InventoryActor) => void;
  resolvePortableConfig?: (command: AgentCreation, actor: InventoryActor) => Promise<Record<string, unknown>> | Record<string, unknown>;
  resolveSkillRefs?: (command: AgentCreation, actor: InventoryActor) => Promise<readonly SkillRef[]> | readonly SkillRef[];
  classifyBlockers?: (config: Record<string, unknown>, refs: readonly SkillRef[], command: AgentCreation, actor: InventoryActor) => { creationBlockers: readonly { code: string; item?: string; requirement?: string }[]; startBlockers: readonly { code: string; item?: string; requirement?: string }[] };
  recheckCreationPolicy?: (tx: OrgOpsDb, command: AgentCreation, actor: InventoryActor, checked: AgentProvisioningPreflight) => void;
  writeTemplateOriginAndRequirements?: (tx: OrgOpsDb, agentId: string, command: Extract<AgentCreation, { kind: "TEMPLATE" }>, config: Record<string, unknown>, actor: InventoryActor) => void;
  writeAudit?: (tx: OrgOpsDb, event: Record<string, unknown>) => void;
  templateOptions?: (actor: InventoryActor) => unknown;
  templateInstantiation?: TemplateProvisioningBridge;
  resolveWorkspacePath?: (path: string) => string;
  isWorkspaceAllowed?: (path: string) => boolean;
  now?: () => number;
  newId?: () => string;
}>;

export type AgentProvisioning = Readonly<{
  toAgentCreation(body: unknown, actor: InventoryActor): AgentCreation;
  preflight(command: AgentCreation, actor: InventoryActor): Promise<AgentProvisioningPreflight>;
  create(command: AgentCreation, actor: InventoryActor): Promise<AgentProvisioningReceipt>;
  templateOptions(actor: InventoryActor): Promise<unknown>;
  instantiateTemplate?(input: unknown, actor: InventoryActor): Promise<unknown>;
}>;

function localSelection(command: AgentCreation) { return command.localSkills; }
function catalogSelection(command: AgentCreation) { return command.catalogSkills; }
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "idempotencyKey").sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
}
function requestDigest(command: AgentCreation): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(command))).digest("hex");
}

export function toAgentCreation(body: unknown, _actor?: InventoryActor): AgentCreation {
  const candidate = body && typeof body === "object" && !Array.isArray(body) && !("idempotencyKey" in body) ? { ...(body as Record<string, unknown>), idempotencyKey: randomUUID() } : body;
  const parsed = ProvisionAgentSchema.parse(candidate);
  if (parsed.kind === "BLANK") return AgentCreationSchema.parse({ kind: "BLANK", local: { idempotencyKey: parsed.idempotencyKey, name: parsed.name, visibility: parsed.visibility, mode: parsed.mode, modelId: parsed.modelId, workspacePath: parsed.workspacePath, runnerId: parsed.runnerId, desiredState: parsed.desiredState }, localSkills: parsed.localSkills, catalogSkills: parsed.catalogSkills });
  return AgentCreationSchema.parse({ kind: "TEMPLATE", packageReleaseId: parsed.packageReleaseId, local: { idempotencyKey: parsed.idempotencyKey, name: parsed.name, visibility: parsed.visibility, modelId: parsed.modelId, workspacePath: parsed.workspacePath, runnerId: parsed.runnerId }, secretBindings: parsed.secretBindings.map(binding => ({ ...binding })), localSkills: parsed.localSkills, catalogSkills: parsed.catalogSkills });
}

/**
 * The resolver deliberately uses an encrypted, short-lived envelope rather than
 * a database token. The plaintext secret id only exists while binding inside the
 * caller's transaction.
 */
export function createSecretReferenceResolver(options: Readonly<{
  key: Buffer;
  db?: OrgOpsDb;
  now?: () => number;
  canUseSecret?: (actor: InventoryActor, secret: { id: string; name: string; scopeType: string; scopeId: string | null }) => boolean;
}>): SecretReferenceResolver {
  const now = options.now ?? Date.now;
  const purpose = "agent-provisioning";
  const canUse = options.canUseSecret ?? (() => true);
  const decode = (actor: InventoryActor, handle: string, expectedPurpose = purpose): { secretId: string } | undefined => {
    if (!OpaqueSecretReferenceSchema.safeParse(handle).success) return undefined;
    try {
      const packed = Buffer.from(handle, "base64url");
      const nonce = packed.subarray(0, 12);
      const tag = packed.subarray(12, 28);
      const decipher = createDecipheriv("aes-256-gcm", options.key, nonce);
      decipher.setAuthTag(tag);
      const raw = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
      const payload = JSON.parse(raw) as { actorId?: string; purpose?: string; expiresAt?: number; secretId?: string; nonce?: string };
      if (payload.actorId !== actor.id || payload.purpose !== expectedPurpose || typeof payload.expiresAt !== "number" || payload.expiresAt <= now() || typeof payload.secretId !== "string" || !payload.nonce) return undefined;
      return { secretId: payload.secretId };
    } catch { return undefined; }
  };
  return {
    issue(actor, secretId, requestedPurpose = purpose) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", options.key, nonce);
      const payload = JSON.stringify({ actorId: actor.id, purpose: requestedPurpose, expiresAt: now() + 10 * 60 * 1000, secretId, nonce: randomBytes(12).toString("base64url") });
      const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url");
    },
    validate(actor, handle, requestedPurpose = purpose) {
      const decoded = decode(actor, handle, requestedPurpose);
      if (!decoded) return "INVALID";
      if (!options.db) return "VALID";
      const secret = options.db.prepare<[string], { id: string; name: string; scope_type: string; scope_id: string | null; ciphertext_b64: string }>("SELECT id,name,scope_type,scope_id,ciphertext_b64 FROM secrets WHERE id=?").get(decoded.secretId);
      if (!secret || !canUse(actor, { id: secret.id, name: secret.name, scopeType: secret.scope_type, scopeId: secret.scope_id })) return "MISSING";
      try { decryptSecret(options.key, secret.ciphertext_b64); return "VALID"; } catch { return "INVALID"; }
    },
    bindForWrite(tx, actor, agentId, bindings) {
      const origin = tx.prepare<[string], { release_id: string }>("SELECT release_id FROM agent_template_origins WHERE agent_id=?").get(agentId);
      if (!origin) fail("FORBIDDEN");
      const release = tx.prepare<[string], { manifest_json: string; kind: string; name: string }>("SELECT manifest_json,kind,name FROM catalog_package_releases WHERE package_release_id=?").get(origin!.release_id);
      if (!release) fail("FORBIDDEN");
      const selectedRelease = release!;
      let manifest: any;
      try { manifest = PackageManifestSchema.parse(JSON.parse(selectedRelease.manifest_json)); } catch { fail("FORBIDDEN"); }
      const requirements = new Map(manifest.secrets.map((requirement: { name: string }) => [requirement.name, requirement]));
      const timestamp = now();
      for (const binding of bindings) {
        const decoded = decode(actor, binding.secretReferenceId);
        if (!decoded) fail("FORBIDDEN");
        const secret = tx.prepare<[string], { id: string; name: string; scope_type: string; scope_id: string | null; ciphertext_b64: string }>("SELECT id,name,scope_type,scope_id,ciphertext_b64 FROM secrets WHERE id=?").get(decoded!.secretId);
        if (!secret) fail("FORBIDDEN");
        const requirement = requirements.get(binding.requirementName);
        if (!requirement || secret!.name !== binding.requirementName || secret!.scope_type !== "package" || (secret!.scope_id !== origin!.release_id && secret!.scope_id !== selectedRelease.name)) fail("FORBIDDEN");
        const selected = secret!;
        if (!canUse(actor, { id: selected.id, name: selected.name, scopeType: selected.scope_type, scopeId: selected.scope_id })) fail("FORBIDDEN");
        try { decryptSecret(options.key, selected.ciphertext_b64); } catch { fail("FORBIDDEN"); }
        tx.prepare(`INSERT INTO agent_package_secret_bindings
          (agent_id,release_id,requirement_name,secret_id,created_by_human_id,revision,created_at,updated_at)
          VALUES (?,?,?,?,?,1,?,?)`).run(agentId, origin!.release_id, binding.requirementName, selected.id, actor.id, timestamp, timestamp);
      }
    },
  };
}

function defaultRefs(command: AgentCreation): SkillRef[] {
  return [
    ...command.localSkills.map(skill => ({ kind: "LOCAL" as const, name: skill.name, localOrigin: "WORKSPACE" as const })),
    ...command.catalogSkills.map(skill => ({ kind: "CATALOG" as const, packageReleaseId: skill.packageReleaseId, name: skill.packageReleaseId, version: "0.0.0", digest: `sha256:${"0".repeat(64)}` })),
  ];
}

export function createAgentProvisioning(deps: AgentProvisioningDeps): AgentProvisioning {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  const requireLiveHuman = deps.requireLiveHuman ?? ((tx, actor) => {
    if (actor.kind !== "HUMAN_ADMIN" && actor.kind !== "AUTHENTICATED_HUMAN") fail("FORBIDDEN");
    const human = tx.prepare<[string], { is_admin: number; must_change_password: number }>("SELECT is_admin,must_change_password FROM humans WHERE id=?").get(actor.id);
    if (!human || human.must_change_password !== 0 || (actor.kind === "HUMAN_ADMIN") !== (human.is_admin === 1)) fail("FORBIDDEN");
  });
  async function preflight(command: AgentCreation, actor: InventoryActor): Promise<AgentProvisioningPreflight> {
    const parsed = AgentCreationSchema.parse(command);
    requireLiveHuman(deps.db, actor);
    if (parsed.kind === "TEMPLATE" && parsed.secretBindings.length > 0 && !deps.secretReferenceResolver) fail("FORBIDDEN");
    const missingSecretBindings: string[] = [];
    if (parsed.kind === "TEMPLATE" && deps.secretReferenceResolver) {
      for (const binding of parsed.secretBindings) {
        const validity = deps.secretReferenceResolver.validate(actor, binding.secretReferenceId, "agent-provisioning");
        if (validity === "INVALID") fail("FORBIDDEN");
        if (validity === "MISSING") missingSecretBindings.push(binding.requirementName);
      }
    }
    const workspace = deps.resolveWorkspacePath?.(parsed.local.workspacePath);
    if (deps.resolveWorkspacePath && (!workspace || deps.isWorkspaceAllowed && !deps.isWorkspaceAllowed(workspace))) fail("INVALID_REQUEST");
    const exactConfig: Record<string, unknown> = await (deps.resolvePortableConfig?.(parsed, actor) ?? {});
    if (workspace) exactConfig.workspacePath = workspace;
    const exactSkillRefs = await (deps.resolveSkillRefs?.(parsed, actor) ?? defaultRefs(parsed));
    const classified = deps.classifyBlockers?.(exactConfig, exactSkillRefs, parsed, actor) ?? { creationBlockers: [], startBlockers: [] };
    const startBlockers = [...classified.startBlockers];
    for (const requirement of missingSecretBindings) startBlockers.push({ code: "REQUIREMENTS_UNSATISFIED", item: requirement });
    if (parsed.kind === "TEMPLATE") {
      const requirements = (exactConfig.requirements as Array<{ name: string; required?: boolean }> | undefined) ?? [];
      const bound = new Set(parsed.secretBindings.map(binding => binding.requirementName));
      for (const requirement of requirements.filter(item => item.required !== false && !bound.has(item.name))) startBlockers.push({ code: "REQUIREMENTS_UNSATISFIED", item: requirement.name });
    }
    return AgentProvisioningPreflightSchema.parse({ ok: classified.creationBlockers.length === 0, creationBlockers: classified.creationBlockers, startBlockers, exactSkillRefs, exactConfig });
  }
  async function create(command: AgentCreation, actor: InventoryActor): Promise<AgentProvisioningReceipt> {
    const parsed = AgentCreationSchema.parse(command);
    const operationId = parsed.local.idempotencyKey;
    const digest = requestDigest(parsed);
    try {
      const existing = deps.db.prepare<[string, string], { request_digest: string; receipt_json: string }>("SELECT request_digest,receipt_json FROM agent_provision_operations WHERE actor_human_id=? AND operation_id=?").get(actor.id, operationId);
      if (existing) {
        if (existing.request_digest !== digest) fail("STATE_CONFLICT");
        return AgentProvisioningReceiptSchema.parse(JSON.parse(existing.receipt_json));
      }
      const checked = await preflight(parsed, actor);
      if (checked.creationBlockers.length > 0) fail(checked.creationBlockers[0]!.code);
      const result = deps.db.transaction(() => {
        const concurrent = deps.db.prepare<[string, string], { request_digest: string; receipt_json: string }>("SELECT request_digest,receipt_json FROM agent_provision_operations WHERE actor_human_id=? AND operation_id=?").get(actor.id, operationId);
        if (concurrent) {
          if (concurrent.request_digest !== digest) fail("STATE_CONFLICT");
          return AgentProvisioningReceiptSchema.parse(JSON.parse(concurrent.receipt_json));
        }
        requireLiveHuman(deps.db, actor);
        deps.recheckCreationPolicy?.(deps.db, parsed, actor, checked);
        const id = newId();
        const checkedCatalog = checked.exactSkillRefs.filter((ref): ref is Extract<SkillRef, { kind: "CATALOG" }> => ref.kind === "CATALOG");
        const explicitPreloads = new Map(parsed.catalogSkills.map(skill => [skill.packageReleaseId, skill.preload]));
        const reviewedPreloads = new Set(Array.isArray((checked.exactConfig ?? {}).skillPreloads) ? (checked.exactConfig as any).skillPreloads : []);
        const catalog = checkedCatalog.map(ref => ({ packageReleaseId: ref.packageReleaseId, preload: reviewedPreloads.has(ref.name) || explicitPreloads.get(ref.packageReleaseId) === true }));
        const desiredState = catalog.length > 0 ? "STOPPED" : parsed.kind === "BLANK" ? parsed.local.desiredState : "STOPPED";
        const mode = parsed.kind === "BLANK" ? parsed.local.mode : ((checked.exactConfig ?? {}).mode as string | undefined) ?? "CLASSIC";
        const runtime = ((checked.exactConfig ?? {}).runtime ?? {}) as Record<string, unknown>;
        const wrappedConfig = parsed.kind === "TEMPLATE" ? JSON.stringify((checked.exactConfig ?? {}).wrappedConfig ?? {}) : "{}";
        const timestamp = now();
        deps.db.prepare(`INSERT INTO agents
          (id,name,model_id,system_instructions,soul_path,soul_contents,workspace_path,allow_outside_workspace,
           llm_call_timeout_ms,classic_max_model_steps,context_session_gap_ms,emit_audit_events,memory_context_mode,
           mode,visibility,owner_human_id,desired_state,runtime_state,assigned_runner_id,created_at,updated_at,
           enabled_skills_json,always_preloaded_skills_json,wrapped_config_json,revision)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
          id, parsed.local.name, parsed.local.modelId, String((checked.exactConfig ?? {}).systemInstructions ?? ""), `souls/${parsed.local.name}.md`, String((checked.exactConfig ?? {}).soulContents ?? ""), String((checked.exactConfig ?? {}).workspacePath ?? parsed.local.workspacePath), 0,
          runtime.llmCallTimeoutMs ?? null, runtime.classicMaxModelSteps ?? null, runtime.contextSessionGapMs ?? null, runtime.emitAuditEvents === false ? 0 : 1, mode === "WRAPPED" ? "OFF" : runtime.memoryContextMode ?? "PER_CHANNEL_CROSS_CHANNEL",
          mode, parsed.local.visibility, actor.id, desiredState, "STOPPED", parsed.local.runnerId, timestamp, timestamp,
          "[]", "[]", wrappedConfig,
        );
        if (parsed.kind === "TEMPLATE") deps.writeTemplateOriginAndRequirements?.(deps.db, id, parsed, checked.exactConfig ?? {}, actor);
        const commands: SkillCommand[] = [
          ...localSelection(parsed).map(skill => ({ kind: "LOCAL" as const, operation: "ADD" as const, agentId: id, name: skill.name, preload: skill.preload, expectedAgentRevision: 1 })),
          ...catalog.map(skill => ({ kind: "CATALOG" as const, operation: "ASSIGN" as const, agentId: id, packageReleaseId: skill.packageReleaseId, preload: skill.preload, expectedAgentRevision: 1, expectedAssignmentRevision: 0 })),
        ];
        let queuedDeploymentIds: string[] = [];
        if (commands.length > 0) {
          const management = deps.management;
          if (!management) fail("STORAGE_FAILURE");
          const scoped = management!.inTransaction(deps.db, actor, commands, 1);
          scoped.recheck();
          const applied = scoped.applyAll();
          if (applied.deploymentId) queuedDeploymentIds = [applied.deploymentId];
        }
        if (parsed.kind === "TEMPLATE" && deps.secretReferenceResolver && parsed.secretBindings.length > 0) deps.secretReferenceResolver.bindForWrite(deps.db, actor, id, parsed.secretBindings);
        if (parsed.kind === "TEMPLATE") deps.writeAudit?.(deps.db, { type: "audit.catalog.template.instantiated", source: "system", status: "DELIVERED", channelId: null, payload: { actorKind: actor.kind === "HUMAN_ADMIN" ? "ADMIN" : "GRANT", actorId: actor.id, action: "template.instantiate", outcome: "SUCCEEDED", revision: 1, releaseId: parsed.packageReleaseId, agentId: id, runnerId: parsed.local.runnerId, digest: String((checked.exactConfig ?? {}).digest ?? "") } });
        const requirements = parsed.kind === "TEMPLATE" && Array.isArray((checked.exactConfig ?? {}).requirements) ? (checked.exactConfig as { requirements: Array<{ name: string; required?: boolean }> }).requirements.map((requirement) => ({ name: requirement.name, state: parsed.secretBindings.some((binding) => binding.requirementName === requirement.name) ? "SATISFIED" as const : "MISSING" as const })) : undefined;
        const receipt = AgentProvisioningReceiptSchema.parse({ id, name: parsed.local.name, desiredState, runtimeState: "STOPPED", queuedDeploymentIds, startBlockers: checked.startBlockers, ...(requirements ? { requirements } : {}) });
        deps.db.prepare("INSERT INTO agent_provision_operations (operation_id,actor_human_id,request_digest,state,agent_id,receipt_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(operationId, actor.id, digest, "COMPLETED", id, JSON.stringify(receipt), timestamp, timestamp);
        return receipt;
      }).immediate();
      return result;
    } catch (error) {
      if (error instanceof AgentProvisioningError) throw error;
      const candidate = error instanceof Error && "code" in error ? (error as { code?: unknown }).code : undefined;
      const parsedCode = CatalogLibraryErrorCodeSchema.safeParse(candidate);
      throw new AgentProvisioningError(parsedCode.success ? parsedCode.data : "STORAGE_FAILURE");
    }
  }
  return {
    toAgentCreation,
    preflight,
    create,
    async templateOptions(actor) { return deps.templateOptions?.(actor) ?? { runners: [], models: [], secretReferences: [], templates: [] }; },
    async instantiateTemplate(input, actor) {
      const templateInstantiation = deps.templateInstantiation;
      if (!templateInstantiation) fail("STORAGE_FAILURE");
      return templateInstantiation!.instantiateTemplate(input, actor);
    },
  };
}

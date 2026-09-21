import { z } from "zod";
import type { OrgOpsDb } from "@orgops/db";
import {
  CatalogAuditEventSchema,
  PackageManifestSchema,
  SecretBindingMutationRequestSchema,
  SecretBindingMutationResultSchema,
  type AuthenticatedHuman,
  type CatalogAuditEvent,
  type SecretBindingMutationRequest,
  type SecretBindingMutationResult,
} from "@orgops/schemas";

const INT_MAX = 2_147_483_647;
const id = z.string().min(1).max(200);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const OriginSchema = z.object({
  agent_id: id, release_id: id, mode: z.enum(["CLASSIC", "RLM_REPL", "WRAPPED"]),
  consumed_by_kind: z.enum(["ADMIN", "GRANT"]), consumed_by_human_id: id, grant_id: id.nullable(),
  authority_source_id: id, content_source_id: id, package_kind: z.enum(["skill", "native-agent", "wrapped-agent"]),
  package_name: id, package_version: id, catalog_commit: z.string().min(1).max(200), package_commit: z.string().min(1).max(200),
  package_path: z.string().min(1).max(4096), package_digest: digest, created_at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((row, context) => {
  if ((row.consumed_by_kind === "ADMIN") !== (row.grant_id === null)) context.addIssue({ code: "custom", message: "grant provenance invariant" });
});
const ReleaseSchema = z.object({
  package_release_id: id, authority_source_id: id, content_source_id: id,
  kind: z.enum(["skill", "native-agent", "wrapped-agent"]), name: id, version: id, digest,
  catalog_commit: z.string().min(1).max(200), package_commit: z.string().min(1).max(200), package_path: z.string().min(1).max(4096),
  manifest_json: z.string().max(262144),
}).strict();
const SourceIdentitySchema = z.object({ source_id: id, repository_identity: z.string().min(1).max(4096), ref: z.string().min(1).max(1024) }).strict();

export class SecretBindingMutationError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "FORBIDDEN" | "STATE_CONFLICT" | "REVISION_CONFLICT" | "INSPECTION_FAILED" | "STORAGE_FAILURE") {
    super(code);
  }
}

type SecretBindingMutationDeps = {
  db: OrgOpsDb;
  writeAudit: (tx: OrgOpsDb, event: CatalogAuditEvent) => void;
  canUseSecret?: (actor: AuthenticatedHuman, secret: { id: string; name: string; scopeType: string; scopeId: string | null }) => boolean;
  isSecretUsable?: (ciphertext: string) => boolean;
  now?: () => number;
};

const fail = (code: SecretBindingMutationError["code"]): never => { throw new SecretBindingMutationError(code); };

export function createSecretBindingMutation({ db, writeAudit, canUseSecret = () => true, isSecretUsable = () => false, now = Date.now }: SecretBindingMutationDeps) {
  function bind(agentId: string, requirementName: string, rawInput: SecretBindingMutationRequest, actor: AuthenticatedHuman): SecretBindingMutationResult {
    try {
      if (!id.safeParse(agentId).success || !/^[A-Z][A-Z0-9_]{0,63}$/.test(requirementName)) fail("INVALID_REQUEST");
      const input = SecretBindingMutationRequestSchema.safeParse(rawInput);
      if (!input.success) fail("INVALID_REQUEST");
      const request = input.data!;
      return SecretBindingMutationResultSchema.parse(db.transaction(() => {
        const human = db.prepare<[string], { id: string; is_admin: number; must_change_password: number }>(
          "SELECT id,is_admin,must_change_password FROM humans WHERE id=?",
        ).get(actor.id);
        if (!human || human.must_change_password !== 0
          || (actor.kind === "HUMAN_ADMIN") !== (human.is_admin === 1)) fail("FORBIDDEN");
        const liveHuman = human!;
        const agent = db.prepare<[string], { id: string; owner_human_id: string | null; desired_state: string; runtime_state: string; revision: number }>(
          "SELECT id,owner_human_id,desired_state,runtime_state,revision FROM agents WHERE id=?",
        ).get(agentId);
        if (!agent || (actor.kind !== "HUMAN_ADMIN" && agent.owner_human_id !== actor.id)
          || (actor.kind === "HUMAN_ADMIN" && liveHuman.is_admin !== 1)) fail("FORBIDDEN");
        const liveAgent = agent!;
        if (liveAgent.desired_state !== "STOPPED" || liveAgent.runtime_state !== "STOPPED") fail("STATE_CONFLICT");
        if (liveAgent.revision !== request.expectedAgentRevision) fail("REVISION_CONFLICT");
        if (liveAgent.revision >= INT_MAX) fail("REVISION_CONFLICT");

        const originRaw = db.prepare<[string], unknown>(`SELECT agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,grant_id,
          authority_source_id,content_source_id,package_kind,package_name,package_version,catalog_commit,package_commit,package_path,package_digest,created_at
          FROM agent_template_origins WHERE agent_id=?`).get(agentId);
        const originResult = OriginSchema.safeParse(originRaw);
        if (!originResult.success) fail("STATE_CONFLICT");
        const liveOrigin = originResult.data!;
        if (liveOrigin.agent_id !== agentId) fail("STATE_CONFLICT");
        const releaseResult = ReleaseSchema.safeParse(db.prepare<[string], unknown>(`SELECT package_release_id,authority_source_id,content_source_id,
          kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json
          FROM catalog_package_releases WHERE package_release_id=?`).get(liveOrigin.release_id));
        if (!releaseResult.success) fail("STATE_CONFLICT");
        const liveRelease = releaseResult.data!;
        const authoritySource = SourceIdentitySchema.safeParse(db.prepare<[string], unknown>(
          "SELECT source_id,repository_identity,ref FROM catalog_sources WHERE source_id=?",
        ).get(liveRelease.authority_source_id));
        const contentSource = SourceIdentitySchema.safeParse(db.prepare<[string], unknown>(
          "SELECT source_id,repository_identity,ref FROM catalog_sources WHERE source_id=?",
        ).get(liveRelease.content_source_id));
        if (!authoritySource.success || !contentSource.success
          || liveOrigin.authority_source_id !== liveRelease.authority_source_id
          || liveOrigin.content_source_id !== liveRelease.content_source_id
          || liveOrigin.package_kind !== liveRelease.kind || liveOrigin.package_name !== liveRelease.name
          || liveOrigin.package_version !== liveRelease.version || liveOrigin.catalog_commit !== liveRelease.catalog_commit
          || liveOrigin.package_commit !== liveRelease.package_commit || liveOrigin.package_path !== liveRelease.package_path
          || liveOrigin.package_digest !== liveRelease.digest) fail("STATE_CONFLICT");
        const manifest = (() => { try { return PackageManifestSchema.parse(JSON.parse(liveRelease.manifest_json)); } catch { return fail("STATE_CONFLICT"); } })();
        const modeMatches = liveRelease.kind === "native-agent" && manifest.kind === "native-agent" ? manifest.native.mode === liveOrigin.mode
          : liveRelease.kind === "wrapped-agent" ? liveOrigin.mode === "WRAPPED" : liveOrigin.mode === "CLASSIC" || liveOrigin.mode === "RLM_REPL";
        if (manifest.kind !== liveRelease.kind || manifest.name !== liveRelease.name || manifest.version !== liveRelease.version
          || manifest.digest !== liveRelease.digest || !modeMatches) fail("STATE_CONFLICT");
        const requirement = manifest.secrets.find(item => item.name === requirementName);
        if (!requirement || !requirement.required) fail("INVALID_REQUEST");
        const secret = db.prepare<[string], { id: string; name: string; scope_type: string; scope_id: string | null; ciphertext_b64: string }>(
          "SELECT id,name,scope_type,scope_id,ciphertext_b64 FROM secrets WHERE id=?",
        ).get(request.secretId);
        if (!secret || secret.name !== requirementName || secret.scope_type !== "package" || secret.scope_id !== liveRelease.name) fail("FORBIDDEN");
        const liveSecret = secret!;
        let usable = false;
        try { usable = canUseSecret(actor, { id: liveSecret.id, name: liveSecret.name, scopeType: liveSecret.scope_type, scopeId: liveSecret.scope_id })
          && isSecretUsable(liveSecret.ciphertext_b64) === true; } catch { usable = false; }
        if (!usable) fail("FORBIDDEN");
        // Secret-policy/decryptability hooks are intentionally outside the SQL
        // authority reads. Re-read every immutable identity and the secret after
        // them so a callback race cannot bind against a stale validation.
        const originAfter = OriginSchema.safeParse(db.prepare<[string], unknown>(`SELECT agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,grant_id,
          authority_source_id,content_source_id,package_kind,package_name,package_version,catalog_commit,package_commit,package_path,package_digest,created_at
          FROM agent_template_origins WHERE agent_id=?`).get(agentId));
        const releaseAfter = ReleaseSchema.safeParse(db.prepare<[string], unknown>(`SELECT package_release_id,authority_source_id,content_source_id,
          kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json
          FROM catalog_package_releases WHERE package_release_id=?`).get(liveOrigin.release_id));
        let manifestAfter: unknown;
        try { manifestAfter = PackageManifestSchema.parse(JSON.parse(releaseAfter.success ? releaseAfter.data.manifest_json : "")); } catch { fail("STATE_CONFLICT"); }
        if (!originAfter.success || !releaseAfter.success || JSON.stringify({ origin: originAfter.data, release: releaseAfter.data, manifest: manifestAfter })
          !== JSON.stringify({ origin: liveOrigin, release: liveRelease, manifest })) fail("STATE_CONFLICT");
        const secretAfter = db.prepare<[string], unknown>(
          "SELECT id,name,scope_type,scope_id,ciphertext_b64 FROM secrets WHERE id=?",
        ).get(request.secretId);
        if (JSON.stringify(secretAfter) !== JSON.stringify(liveSecret)) fail("STATE_CONFLICT");

        const existing = db.prepare<[string, string, string], { revision: number }>(
          "SELECT revision FROM agent_package_secret_bindings WHERE agent_id=? AND release_id=? AND requirement_name=?",
        ).get(agentId, liveOrigin.release_id, requirementName);
        const bindingRevision = existing ? existing.revision >= INT_MAX ? fail("REVISION_CONFLICT") : existing.revision + 1 : 1;
        const timestamp = now();
        if (existing) db.prepare(`UPDATE agent_package_secret_bindings SET secret_id=?,created_by_human_id=?,revision=?,updated_at=?
          WHERE agent_id=? AND release_id=? AND requirement_name=? AND revision=?`).run(request.secretId, actor.id, bindingRevision, timestamp,
          agentId, liveOrigin.release_id, requirementName, existing.revision);
        else db.prepare(`INSERT INTO agent_package_secret_bindings
          (agent_id,release_id,requirement_name,secret_id,created_by_human_id,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
          .run(agentId, liveOrigin.release_id, requirementName, request.secretId, actor.id, 1, timestamp, timestamp);
        const changed = db.prepare("UPDATE agents SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND desired_state='STOPPED' AND runtime_state='STOPPED'")
          .run(timestamp, agentId, liveAgent.revision);
        if (changed.changes !== 1) fail("REVISION_CONFLICT");
        const event = CatalogAuditEventSchema.parse({ type: "audit.catalog.secret_binding.changed", source: "system", status: "DELIVERED", channelId: null,
          payload: { actorKind: actor.kind, actorId: actor.id, action: "secret-binding.put", outcome: "SUCCEEDED", revision: liveAgent.revision + 1,
            releaseId: liveOrigin.release_id, agentId } });
        writeAudit(db, event);
        return { agentId, requirementName, revision: liveAgent.revision + 1, state: "SATISFIED" };
      }).immediate());
    } catch (error) {
      if (error instanceof SecretBindingMutationError) throw error;
      throw new SecretBindingMutationError("STORAGE_FAILURE");
    }
  }
  return { bind };
}

export type SecretBindingMutation = ReturnType<typeof createSecretBindingMutation>;

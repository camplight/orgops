import { z } from "zod";
import {
  AgentViewSchema,
  ApiActivationStateViewSchema,
  AuthenticatedPrincipalSchema,
  GrantViewSchema,
  PackageReleaseIdSchema,
  PackageReleaseViewSchema,
  ReleaseExecutionPreviewSchema,
  RunnerViewSchema,
  type AgentView,
  type AuthenticatedHuman,
  type CatalogPolicy,
  type GrantView,
  type PackageReleaseView,
  type PolicyDecision,
  type PolicyDecisionInput,
  type PolicyAction,
} from "@orgops/schemas";
import { parseCanonicalCatalogGrant } from "./grant-identity";

type PolicyRelease = Pick<PackageReleaseView,
  "packageReleaseId" | "reviewState" | "installationState" | "executionPreview" | "apiActivation">;

const PolicyReleaseSchema = z.object({
  packageReleaseId: PackageReleaseIdSchema,
  reviewState: z.enum(["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]),
  installationState: z.enum(["ABSENT", "INSTALLED", "QUARANTINED"]),
  executionPreview: ReleaseExecutionPreviewSchema,
  apiActivation: ApiActivationStateViewSchema,
}).strict();

export const CatalogPolicyReleaseStateSchema = z.object({
  release: PolicyReleaseSchema,
  sourceEnabled: z.boolean(),
  externalSourceAllowed: z.boolean(),
}).strict();

export type CatalogPolicyReleaseState = Readonly<{
  release: PolicyRelease;
  sourceEnabled: boolean;
  externalSourceAllowed: boolean;
}>;

export type CatalogPolicyDeps = Readonly<{
  canManageAgent(actor: AuthenticatedHuman, agent: AgentView): boolean;
  readRelease(releaseId: string): CatalogPolicyReleaseState | undefined;
  readGrant(actor: AuthenticatedHuman, releaseId: string): GrantView | undefined;
}>;

const PolicyActionSchema = z.enum([
  "SOURCE_MANAGE", "RELEASE_REVIEW", "RELEASE_INSTALL", "GRANT_MANAGE", "API_EXECUTION_APPROVE",
  "LIBRARY_VIEW", "TEMPLATE_INSTANTIATE", "SKILL_ASSIGN", "ROLLOUT_CREATE", "RUNNER_DEPLOY",
]);
const allowedInputKeys = new Set(["action", "actor", "release", "grant", "agent", "runner"]);
const adminOnly = new Set<PolicyAction>([
  "SOURCE_MANAGE", "RELEASE_REVIEW", "RELEASE_INSTALL", "GRANT_MANAGE", "API_EXECUTION_APPROVE",
]);
const consumption = new Set<PolicyAction>([
  "LIBRARY_VIEW", "TEMPLATE_INSTANTIATE", "SKILL_ASSIGN", "ROLLOUT_CREATE",
]);
const agentManagement = new Set<PolicyAction>(["SKILL_ASSIGN", "ROLLOUT_CREATE"]);

const denied = (reasonCode: Exclude<PolicyDecision, { allow: true }>["reasonCode"]): PolicyDecision => ({ allow: false, reasonCode });

type ValidatedInput = {
  action: PolicyAction;
  actor: z.infer<typeof AuthenticatedPrincipalSchema>;
  release?: PackageReleaseView;
  grant?: GrantView;
  agent?: AgentView;
  runner?: z.infer<typeof RunnerViewSchema>;
};

type InputValidation = { ok: true; input: ValidatedInput } | { ok: false; decision: PolicyDecision };

function validateInput(input: unknown): InputValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !allowedInputKeys.has(key))) return { ok: false, decision: denied("FORBIDDEN") };
  const candidate = input as Record<string, unknown>;
  const action = PolicyActionSchema.safeParse(candidate.action);
  const actor = AuthenticatedPrincipalSchema.safeParse(candidate.actor);
  if (!action.success || !actor.success) return { ok: false, decision: denied("FORBIDDEN") };
  const release = candidate.release === undefined ? undefined : PackageReleaseViewSchema.safeParse(candidate.release);
  if (release !== undefined && !release.success) return { ok: false, decision: denied("NOT_FOUND") };
  const grant = candidate.grant === undefined ? undefined : GrantViewSchema.safeParse(candidate.grant);
  if (grant !== undefined && !grant.success) return { ok: false, decision: denied("GRANT_REQUIRED") };
  const agent = candidate.agent === undefined ? undefined : AgentViewSchema.safeParse(candidate.agent);
  if (agent !== undefined && !agent.success) return { ok: false, decision: denied("FORBIDDEN") };
  const runner = candidate.runner === undefined ? undefined : RunnerViewSchema.safeParse(candidate.runner);
  if (runner !== undefined && !runner.success) return { ok: false, decision: denied("FORBIDDEN") };
  return {
    ok: true,
    input: {
      action: action.data,
      actor: actor.data,
      ...(release?.success ? { release: release.data } : {}),
      ...(grant?.success ? { grant: grant.data } : {}),
      ...(agent?.success ? { agent: agent.data } : {}),
      ...(runner?.success ? { runner: runner.data } : {}),
    },
  };
}

function grantMatches(grant: GrantView | undefined, actor: AuthenticatedHuman, releaseId: string): boolean {
  if (!grant || grant.revokedAt !== null || grant.releaseId !== releaseId) return false;
  if (grant.subject.kind === "ORGANIZATION") return true;
  return grant.subject.humanId === actor.id;
}

export function createCatalogPolicy({ canManageAgent, readRelease, readGrant }: CatalogPolicyDeps): CatalogPolicy {
  function currentRelease(input: ValidatedInput): CatalogPolicyReleaseState | undefined {
    if (!input.release) return undefined;
    try {
      const parsed = CatalogPolicyReleaseStateSchema.safeParse(readRelease(input.release.packageReleaseId));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  function currentGrant(actor: AuthenticatedHuman, releaseId: string): GrantView | undefined {
    try {
      return parseCanonicalCatalogGrant(readGrant(actor, releaseId));
    } catch {
      return undefined;
    }
  }

  function manageable(actor: AuthenticatedHuman, agent: AgentView): boolean {
    try {
      return canManageAgent(actor, agent) === true;
    } catch {
      return false;
    }
  }

  function approvedAndAvailable(state: CatalogPolicyReleaseState | undefined): PolicyDecision | undefined {
    if (!state) return denied("NOT_FOUND");
    if (!state.sourceEnabled || !state.externalSourceAllowed) return denied("SOURCE_NOT_ALLOWED");
    if (state.release.reviewState !== "APPROVED") return denied("RELEASE_NOT_APPROVED");
    return undefined;
  }

  function installed(state: CatalogPolicyReleaseState): PolicyDecision | undefined {
    return state.release.installationState === "INSTALLED" ? undefined : denied("INSTALLATION_REQUIRED");
  }

  function apiActive(state: CatalogPolicyReleaseState): PolicyDecision | undefined {
    if (state.release.executionPreview.apiEventShapes.length === 0) return undefined;
    return state.release.apiActivation.approvalState === "APPROVED" && state.release.apiActivation.runtimeState === "ACTIVE"
      ? undefined
      : denied("API_ACTIVATION_REQUIRED");
  }

  function decideValidated(input: ValidatedInput): PolicyDecision {
    const { action, actor } = input;

    if (adminOnly.has(action)) {
      if (actor.kind !== "HUMAN_ADMIN") return denied("FORBIDDEN");
      if (action === "SOURCE_MANAGE" || action === "RELEASE_REVIEW") return { allow: true };
      const state = currentRelease(input);
      const unavailable = approvedAndAvailable(state);
      if (unavailable) return unavailable;
      if (action === "RELEASE_INSTALL") return { allow: true };
      return installed(state!) ?? { allow: true };
    }

    if (consumption.has(action)) {
      if (actor.kind !== "HUMAN_ADMIN" && actor.kind !== "AUTHENTICATED_HUMAN") return denied("FORBIDDEN");
      if (agentManagement.has(action) && (!input.agent || !manageable(actor, input.agent))) return denied("FORBIDDEN");
      const state = currentRelease(input);
      const unavailable = approvedAndAvailable(state);
      if (unavailable) return unavailable;
      const notInstalled = installed(state!);
      if (notInstalled) return notInstalled;
      const inactive = apiActive(state!);
      if (inactive) return inactive;
      if (actor.kind !== "HUMAN_ADMIN" && !grantMatches(currentGrant(actor, state!.release.packageReleaseId), actor, state!.release.packageReleaseId)) {
        return denied("GRANT_REQUIRED");
      }
      return { allow: true };
    }

    if (actor.kind !== "RUNNER") return denied("FORBIDDEN");
    const state = currentRelease(input);
    const unavailable = approvedAndAvailable(state);
    if (unavailable) return unavailable;
    const notInstalled = installed(state!);
    if (notInstalled) return notInstalled;
    const inactive = apiActive(state!);
    if (inactive) return inactive;
    if (!input.runner || !input.agent || actor.runnerId !== input.runner.id || input.agent.assignedRunnerId !== input.runner.id) return denied("FORBIDDEN");
    return { allow: true };
  }

  function decide(input: PolicyDecisionInput): PolicyDecision {
    try {
      const validated = validateInput(input);
      return validated.ok ? decideValidated(validated.input) : validated.decision;
    } catch {
      return denied("FORBIDDEN");
    }
  }

  return { decide };
}

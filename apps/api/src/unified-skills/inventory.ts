import {
  InventoryFiltersSchema,
  SkillInventoryItemSchema,
  type AgentSkillInventory,
  type InventoryActor,
  type InventoryFilters,
  type SkillInventoryItem,
  type UnifiedSkillInventory,
  type PackageReleaseView,
  type CatalogPolicy,
  type AgentView,
  type GrantView,
  type SkillReadiness,
} from "@orgops/schemas";

export type LocalInventoryItem = {
  name: string;
  description: string;
  localOrigin?: "BUILT_IN" | "WORKSPACE";
  trustedRootKey?: string;
  path?: string;
};
export type CatalogInventoryItem = {
  packageReleaseId: string;
  name: string;
  version: string;
  digest: string;
  description: string;
  installed?: boolean;
  release?: PackageReleaseView;
  adminProvenance?: SkillInventoryItem["adminProvenance"];
  readiness?: SkillInventoryItem["readiness"];
  assignment?: SkillInventoryItem["assignment"];
};
export type CatalogEvaluation = { visible: boolean; readiness: SkillReadiness };
export type UnifiedSkillInventoryDeps = Readonly<{
  listLocal: () => readonly LocalInventoryItem[];
  listCatalogSkills: (actor: InventoryActor) => readonly CatalogInventoryItem[];
  projectLocal: (item: LocalInventoryItem, actor: InventoryActor) => unknown;
  projectCatalog: (item: CatalogInventoryItem, actor: InventoryActor, agentId?: string) => unknown;
  requireManageableAgent: (agentId: string, actor: InventoryActor) => { revision: number };
  withReadSnapshot: <T>(read: () => T) => T;
  policy: CatalogPolicy;
  evaluateCatalog: (item: CatalogInventoryItem, actor: InventoryActor, agentId?: string) => CatalogEvaluation;
  grantFor: (actor: InventoryActor, releaseId: string) => GrantView | undefined;
  agentFor: (agentId: string) => AgentView | undefined;
}>;

function normalizeFilters(filters: Partial<InventoryFilters> | undefined): InventoryFilters {
  return InventoryFiltersSchema.parse(filters ?? {});
}
function matches(item: SkillInventoryItem, filters: InventoryFilters): boolean {
  if (filters.origin !== "ALL" && item.ref.kind !== filters.origin) return false;
  if (filters.availability !== "ALL") {
    const available = item.readiness.state === "BLOCKED" && item.readiness.blockers.some(blocker => blocker.code === "INSTALLATION_REQUIRED");
    const installed = !available;
    if (filters.availability === "AVAILABLE" && !available) return false;
    if (filters.availability === "INSTALLED" && !installed) return false;
  }
  if (filters.query) {
    const query = filters.query.toLocaleLowerCase();
    if (![item.ref.name, item.description, item.version].filter(Boolean).some(value => value!.toLocaleLowerCase().includes(query))) return false;
  }
  return true;
}
function compare(a: SkillInventoryItem, b: SkillInventoryItem): number {
  return a.ref.name.localeCompare(b.ref.name) || a.ref.kind.localeCompare(b.ref.kind) || (a.version ?? "").localeCompare(b.version ?? "");
}

export function createUnifiedSkillInventory(deps: UnifiedSkillInventoryDeps): UnifiedSkillInventory {
  function localProjection(item: LocalInventoryItem, actor: InventoryActor): SkillInventoryItem {
    const projected = deps.projectLocal(item, actor);
    if (actor.kind === "HUMAN_ADMIN") return SkillInventoryItemSchema.parse(projected);
    const bounded = { ...(projected as Record<string, unknown>) };
    delete bounded.adminProvenance;
    return SkillInventoryItemSchema.parse({ ...bounded, provenance: "BOUNDED_HUMAN" });
  }
  function catalogProjection(item: CatalogInventoryItem, actor: InventoryActor, agentId?: string): SkillInventoryItem {
    const projected = deps.projectCatalog(item, actor, agentId);
    if (actor.kind === "HUMAN_ADMIN") return SkillInventoryItemSchema.parse(projected);
    const bounded = { ...(projected as Record<string, unknown>) };
    delete bounded.adminProvenance;
    return SkillInventoryItemSchema.parse({ ...bounded, provenance: "BOUNDED_HUMAN" });
  }
  function listItems(actor: InventoryActor, agentId: string | undefined, rawFilters: Partial<InventoryFilters> | undefined): readonly SkillInventoryItem[] {
    const filters = normalizeFilters(rawFilters);
    const local = deps.listLocal().map(item => localProjection(item, actor));
    const catalog = deps.listCatalogSkills(actor).flatMap(item => {
      if (!item.release) return [];
      const grant = deps.grantFor(actor, item.packageReleaseId);
      if (actor.kind !== "HUMAN_ADMIN" && !grant) return [];
      const agent = agentId ? deps.agentFor(agentId) : undefined;
      const decision = deps.policy.decide({ action: agentId ? "SKILL_ASSIGN" : "LIBRARY_VIEW", actor: actor as any, release: item.release, ...(grant ? { grant } : {}), ...(agent ? { agent } : {}) });
      const evaluation = deps.evaluateCatalog(item, actor, agentId);
      const visibleByPolicy = decision.allow || decision.reasonCode === "INSTALLATION_REQUIRED" || decision.reasonCode === "API_ACTIVATION_REQUIRED";
      if (!visibleByPolicy || !evaluation.visible) return [];
      return [catalogProjection({ ...item, readiness: evaluation.readiness }, actor, agentId)];
    });
    return [...local, ...catalog].filter(item => matches(item, filters)).sort(compare);
  }
  return {
    list: async (actor, filters) => deps.withReadSnapshot(() => listItems(actor, undefined, filters)),
    async listForAgent(actor, agentId, filters) {
      return deps.withReadSnapshot(() => {
        const agent = deps.requireManageableAgent(agentId, actor);
        return { items: listItems(actor, agentId, filters), agentRevision: agent.revision };
      });
    },
  };
}

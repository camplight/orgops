import type { GitRepository, ResolvedIdentity, CatalogIndex, ContractIssue } from "@orgops/schemas";
import type { ExportCandidate } from "./export";
import type { PackageSnapshot } from "./content";
import type { CatalogSnapshot, SuppliedPackage, ResolveInput } from "./resolve";
// Fixed offline preparation budgets; no caller may raise them.
export const PUBLICATION_LIMITS = Object.freeze({
    inputJsonBytes: 67108864, selections: 64, treeEntries: 8192, sources: 128,
    catalogs: 31, suppliedPackages: 4032, knownReleases: 4096, totalIndexEntries: 8192,
    aggregateFiles: 8192, decodedBytes: 33554432, outputFiles: 4096,
    outputBytes: 33554432, findings: 4096,
} as const);
export type PublicationTreeEntry = {
    type: "directory";
    path: string;
} | {
    type: "file";
    path: string;
    size: number;
    digest: string;
    executable: boolean;
} | {
    type: "blocked";
    path: string;
}; // symlink/gitlink/special; never followed or written
export type PublicationBase = {
    catalogId: string;
    sourceId: string;
    repository: GitRepository;
    enabled: boolean;
    commit: string;
    indexPath: string;
    indexBase64: string | null;
    inventory: {
        complete: true;
        entries: readonly PublicationTreeEntry[];
    };
    history: {
        complete: true;
        releases: readonly ResolvedIdentity[];
    };
};
export type PublicationSource = {
    sourceId: string;
    repository: GitRepository;
    enabled: boolean;
    allowPackages: boolean;
};
export type PublicationSelection = {
    destinationPath: string;
    candidate: ExportCandidate;
    intent: "new-release" | "update" | "new-destination";
    origin: ResolvedIdentity | null;
};
export type PublicationInput = {
    base: PublicationBase;
    selections: readonly PublicationSelection[];
    sources: readonly PublicationSource[];
    catalogs: readonly CatalogSnapshot[]; // dependency catalogs only; excludes base.catalogId
    packages: readonly SuppliedPackage[]; // existing immutable package evidence only
    knownReleases: readonly ResolvedIdentity[]; // other catalogs; excludes base.catalogId
    target: ResolveInput["target"];
};
export type PublicationIssue = {
    code: ContractIssue["code"] | "INVALID_PUBLICATION_INPUT" | "BASE_EVIDENCE_REQUIRED" | "BASE_CONFLICT" | "DESTINATION_CONFLICT" | "ORIGIN_CONFLICT";
    at: string;
};
export type PublicationResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    issues: PublicationIssue[];
};
export type PublicationBytes = {
    base64: string;
    size: number;
    digest: string;
    executable: boolean;
};
export type PublicationChange = {
    path: string;
    before: PublicationBytes | null;
    after: PublicationBytes;
    review: {
        before: "utf8" | "binary" | "absent";
        after: "utf8" | "binary";
    };
};
export type PublicationPreconditions = {
    repository: GitRepository;
    sourceId: string;
    catalogId: string;
    catalogEnabled: true;
    baseCommit: string;
    indexPath: string;
    oldIndex: PublicationBytes | null;
    inventory: PublicationBase["inventory"];
    history: PublicationBase["history"];
    sources: readonly PublicationSource[];
    target: ResolveInput["target"];
    dependencyCatalogs: readonly CatalogSnapshot[];
    knownReleases: readonly ResolvedIdentity[]; // other-catalog retained evidence
    requiredAbsentPaths: readonly string[]; // new package roots and absent index
    preservedReleases: readonly ResolvedIdentity[]; // all base entries expanded at base commit
};
export type PublicationRevision = {
    type: "exact";
    commit: string;
} | {
    type: "proposal";
};
export type PublicationIdentity = Omit<ResolvedIdentity, "catalogCommit" | "packageCommit"> & {
    catalogRevision: PublicationRevision;
    packageRevision: PublicationRevision;
};
export type PublicationRelease = {
    identity: PublicationIdentity;
    snapshot: PackageSnapshot;
    disposition: "new" | "existing";
};
export type PublicationFinding = {
    ruleId: "TOKEN_PREFIX" | "PRIVATE_KEY_HEADER" | "CREDENTIAL_ASSIGNMENT";
    severity: "warning";
    path: string;
    side: "before" | "after";
    line: number;
    column: number; // 1-based Unicode-code-point location of first match
};
export type PublicationProposal = {
    kind: "offline-publication-proposal";
    preconditions: PublicationPreconditions;
    selections: readonly {
        destinationPath: string;
        intent: PublicationSelection["intent"];
        origin: ResolvedIdentity | null;
        name: string;
        version: string;
        disposition: "new" | "existing";
    }[];
    proposedIndex: CatalogIndex;
    changes: readonly PublicationChange[];
    releases: readonly PublicationRelease[]; // dependency-first complete selected closure
    findings: readonly PublicationFinding[];
    reviewRequired: true;
    scan: {
        kind: "supplementary";
        version: 1;
        binaryFiles: readonly {
            path: string;
            side: "before" | "after";
        }[];
    };
    proposalDigest: string;
};

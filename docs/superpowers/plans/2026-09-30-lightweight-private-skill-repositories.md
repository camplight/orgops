# Lightweight Private Skill Repositories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load skills from explicit external filesystem roots and let authorized agents safely synchronize and publish one private skill repository through a built-in management skill.

**Architecture:** `@orgops/skills` becomes the single multi-root discovery boundary used by API and runner. Existing UI consumes a discovery projection and continues selecting skills by name. A tracked bootstrap skill owns deterministic Git mechanics and receives narrowly scoped write access to the configured external `skills/` directory only when its canonical built-in identity is enabled.

**Tech Stack:** TypeScript, Node.js filesystem/path/child-process APIs, Hono, React, Vitest, local Git fixtures

**Spec:** `docs/superpowers/specs/2026-09-30-lightweight-private-skill-repositories-design.md`

## Global Constraints

- Preserve `<ORGOPS_PROJECT_ROOT>/skills` as the automatic built-in root.
- `ORGOPS_SKILL_ROOTS` contains additional absolute roots separated by Node's platform path delimiter.
- V1 supports one managed repository and a single-machine OrgOps installation; no cross-host synchronization.
- No database migration, catalog/source/release model, repository registry, new route family, or new administration screen.
- Existing Skills UI and agent create/edit selectors must show usable skills from every root.
- Every duplicate skill name is unavailable; root order must never choose a winner.
- Filesystem changes appear on the next `GET /api/skills` and next CLASSIC turn; dynamic API event shapes retain the existing cache TTL.
- Only the canonical built-in `private-skill-repository` skill may grant the configured external `skills/` directory as an additional write root.
- The management helper may stage and publish only paths beneath the configured repository's `skills/` directory.
- Git tokens must never appear in remote URLs, process arguments, Git configuration, events, stdout, or stderr.
- Refuse dirty, divergent, conflicted, mismatched, or concurrently locked repositories. Never automate stash, rebase, reset, clean, conflict resolution, or force push.
- Use npm and the committed `package-lock.json`.
- Follow functional factory/module style; do not introduce classes.

## File and interface map

### Multi-root domain

- Modify `packages/skills/src/index.ts` — root parsing, deterministic discovery, conflicts, diagnostics, retained event-shape loading.
- Modify `packages/skills/src/index.test.ts` — filesystem boundary and compatibility tests.

Public interfaces produced by Task 1:

```ts
type SkillRoot = { path: string; kind: "BUILT_IN" | "EXTERNAL" };
type SkillDocumentMeta = {
  name: string;
  description: string;
  license?: string;
  metadata?: Record<string, unknown>;
  path: string;
};
type SkillMeta = SkillDocumentMeta & { root: SkillRoot };
type SkillConflict = { name: string; paths: string[] };
type SkillRootDiagnostic = {
  path: string;
  code: "MISSING" | "UNREADABLE";
};
type SkillDiscovery = {
  skills: SkillMeta[];
  conflicts: SkillConflict[];
  diagnostics: SkillRootDiagnostic[];
};

resolveSkillRoots(projectRoot: string, configuredRoots?: string): SkillRoot[];
loadSkillMeta(skillDir: string): SkillDocumentMeta | null;
discoverSkills(roots: SkillRoot[]): SkillDiscovery;
listSkills(root: SkillRoot): SkillMeta[]; // compatibility wrapper
```

### API and UI adapters

- Modify `apps/api/src/app.ts` — construct `SKILL_ROOTS` once from config/environment.
- Modify `apps/api/src/routes/skills.ts` — return `SkillDiscovery`.
- Modify `apps/api/src/routes/events.ts` — discover across all roots before loading event shapes.
- Modify `apps/api/src/app.test.ts` — real route/event-shape tests with an external root.
- Modify `apps/admin-ui/src/types.ts` — discovery projection types.
- Modify `apps/admin-ui/src/hooks/useOrgOpsData.ts` — decode discovery and expose usable skills plus warnings.
- Modify `apps/admin-ui/src/screens/SkillsScreen.tsx` — origin and diagnostics display.
- Create `apps/admin-ui/src/screens/SkillsScreen.test.tsx` — merged inventory and warning rendering.
- Modify `apps/admin-ui/src/components/drawers/DashboardDrawers.tsx` and `apps/admin-ui/src/App.tsx` only where props must carry discovery warnings.

### Runner consumption and capability

- Modify `apps/agent-runner/src/runner.ts` — resolve all roots.
- Modify `apps/agent-runner/src/turn-executor.ts` — discover each turn and apply canonical management capability.
- Modify `apps/agent-runner/src/prompt.ts` — list multiple roots accurately.
- Modify `apps/agent-runner/src/prompt.test.ts` — multi-root guidance.
- Create `apps/agent-runner/src/private-skill-repository-access.ts` — pure capability/path decision.
- Create `apps/agent-runner/src/private-skill-repository-access.test.ts` — canonical identity and path mismatch tests.
- Modify `apps/agent-runner/src/turn-executor.test.ts` — external prompt/preload/event-shape/tool-root regression.

Task 3 produces:

```ts
const PRIVATE_SKILL_REPOSITORY_SKILL = "private-skill-repository";

function resolvePrivateSkillRepositoryAccess(input: {
  selectedSkills: SkillMeta[];
  roots: SkillRoot[];
  repositoryPath?: string;
}): { ok: true; skillsPath: string } | { ok: false; reason: string };
```

### Management skill

- Create `skills/private-skill-repository/SKILL.md` — agent workflow and refusal rules.
- Create `skills/private-skill-repository/assets/repository-config.ts` — strict environment parsing and root relationship.
- Create `skills/private-skill-repository/assets/git-process.ts` — argument-array Git execution, bounded/redacted results, temporary askpass cleanup.
- Create `skills/private-skill-repository/assets/skill-changes.ts` — changed-path and `SKILL.md` validation.
- Create `skills/private-skill-repository/assets/manage-repository.ts` — CLI orchestration and atomic lock.
- Create colocated `*.test.ts` files for each helper module.

### Documentation

- Modify `.env.example`.
- Modify `README.md`.
- Modify `apps/api/README.md`.
- Modify `apps/agent-runner/README.md`.
- Modify `docs/SPEC.md`.

---

### Task 1: Multi-root skill discovery

**Files:**
- Modify: `packages/skills/src/index.ts`
- Modify: `packages/skills/src/index.test.ts`

**Interfaces:**
- Consumes: existing `loadSkillMeta(skillDir)` and `loadSkillEventShapes(skills)` behavior.
- Produces: `resolveSkillRoots`, `discoverSkills`, and the exact types in the file map. Retains `listSkills(root)` as a compatibility wrapper returning `discoverSkills([root]).skills`.

- [ ] **Step 1: Add failing root-resolution tests**

Add tests using `delimiter`, `resolve`, and platform-safe temporary absolute paths:

```ts
it("keeps the built-in root and appends normalized external roots", () => {
  const roots = resolveSkillRoots("/project", ["/private/a", "/private/b"].join(delimiter));
  expect(roots).toEqual([
    { path: resolve("/project/skills"), kind: "BUILT_IN" },
    { path: resolve("/private/a"), kind: "EXTERNAL" },
    { path: resolve("/private/b"), kind: "EXTERNAL" },
  ]);
});

it("rejects relative configured roots", () => {
  expect(() => resolveSkillRoots("/project", "relative/skills")).toThrow(
    /ORGOPS_SKILL_ROOTS.*absolute/,
  );
});
```

Also prove empty entries and exact normalized duplicate paths are ignored without removing the built-in root.

- [ ] **Step 2: Run the root tests and verify RED**

Run:

```bash
npx vitest run packages/skills/src/index.test.ts -t "root|configured"
```

Expected: FAIL because `resolveSkillRoots` and root kinds do not exist.

- [ ] **Step 3: Implement root parsing**

Use `node:path` `delimiter`, `isAbsolute`, and `resolve`. Throw one fixed configuration error naming the invalid entry; do not silently resolve a relative external path against process cwd.

```ts
export function resolveSkillRoots(
  projectRoot: string,
  configuredRoots = process.env.ORGOPS_SKILL_ROOTS ?? "",
): SkillRoot[] {
  const builtIn = resolve(projectRoot, "skills");
  const seen = new Set([builtIn]);
  const roots: SkillRoot[] = [{ path: builtIn, kind: "BUILT_IN" }];
  for (const raw of configuredRoots.split(delimiter)) {
    const value = raw.trim();
    if (!value) continue;
    if (!isAbsolute(value)) throw new Error("ORGOPS_SKILL_ROOTS entries must be absolute paths");
    const path = resolve(value);
    if (seen.has(path)) continue;
    seen.add(path);
    roots.push({ path, kind: "EXTERNAL" });
  }
  return roots;
}
```

- [ ] **Step 4: Add failing discovery tests**

Build independent temporary roots and assert:

```ts
const result = discoverSkills([
  { path: builtInRoot, kind: "BUILT_IN" },
  { path: externalRoot, kind: "EXTERNAL" },
]);
expect(result.skills.map(({ name }) => name)).toEqual(["alpha", "beta"]);
expect(result.skills.find(({ name }) => name === "beta")?.root).toEqual({
  path: resolve(externalRoot),
  kind: "EXTERNAL",
});
```

Add cases for:

- two valid skills with the same name in different roots: neither is usable and one sorted conflict contains both paths;
- one missing root alongside one healthy root: healthy skills remain and diagnostics contains `MISSING`;
- an unreadable root by importing Node fs as a namespace and using `vi.spyOn(fs, "readdirSync")` for that exact root: diagnostic `UNREADABLE`;
- malformed frontmatter and symlink child: absent without a conflict;
- deterministic sorting independent of filesystem enumeration order;
- `listSkills({ path, kind })` returning the compatibility array.

- [ ] **Step 5: Run discovery tests and verify RED**

Run:

```bash
npx vitest run packages/skills/src/index.test.ts
```

Expected: FAIL on absent discovery interfaces and duplicate handling.

- [ ] **Step 6: Implement deterministic discovery**

Read each root independently inside `try/catch`, preserve `loadSkillMeta(skillDir): SkillDocumentMeta | null`, attach the current root only after a valid document is loaded, group entries by `skill.name`, exclude every group with length greater than one, and return sorted bounded projections. Do not call `realpathSync` on missing roots; lexical absolute paths are the contract.

Limit conflict and diagnostic paths to configured root plus immediate skill directory; never include file contents.

- [ ] **Step 7: Run package tests and type check**

Run:

```bash
npx vitest run packages/skills/src/index.test.ts
npm run --workspace @orgops/skills lint
```

Expected: all package tests PASS and TypeScript reports no new errors.

- [ ] **Step 8: Commit Task 1**

```bash
git add packages/skills/src/index.ts packages/skills/src/index.test.ts
git commit -m "feat(skills): discover explicit filesystem roots"
```

---

### Task 2: API projection and existing Skills UI integration

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/skills.ts`
- Modify: `apps/api/src/routes/events.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/admin-ui/src/types.ts`
- Modify: `apps/admin-ui/src/hooks/useOrgOpsData.ts`
- Modify: `apps/admin-ui/src/screens/SkillsScreen.tsx`
- Create: `apps/admin-ui/src/screens/SkillsScreen.test.tsx`
- Modify if required by prop flow: `apps/admin-ui/src/components/drawers/DashboardDrawers.tsx`
- Modify if required by prop flow: `apps/admin-ui/src/App.tsx`

**Interfaces:**
- Consumes: `resolveSkillRoots(projectRoot, configuredRoots)` and `discoverSkills(roots)` from Task 1.
- Produces: `GET /api/skills -> SkillDiscovery`; UI continues exposing `skills: SkillMeta[]` to agent forms and separately exposes `skillConflicts`/`skillDiagnostics` to `SkillsScreen`.

- [ ] **Step 1: Add failing API integration tests**

Extend the app test fixture to create a project root with built-in and external skill directories, then construct the app with deterministic skill-root configuration. Prefer adding `skillRoots?: SkillRoot[]` to `AppConfig` for tests rather than mutating global environment.

Assert:

```ts
const body = await response.json();
expect(body.skills.map((skill: any) => skill.name)).toEqual(["built-in", "private"]);
expect(body.skills.find((skill: any) => skill.name === "private").root.kind).toBe("EXTERNAL");
expect(body.conflicts).toEqual([]);
expect(body.diagnostics).toEqual([]);
```

Add a duplicate fixture and prove neither duplicate is returned. Add an external `event-shapes.ts`, advance or disable the existing event-shape cache in the fixture, and prove POST `/api/events` recognizes its event type.

- [ ] **Step 2: Run focused API tests and verify RED**

Run:

```bash
npx vitest run apps/api/src/app.test.ts -t "external skill|duplicate skill|external event shape"
```

Expected: FAIL because app/routes still use one `SKILL_ROOT` and `/api/skills` returns an array.

- [ ] **Step 3: Wire root-set discovery through API composition**

In `createApp`:

```ts
const SKILL_ROOTS = config.skillRoots ?? resolveSkillRoots(
  PROJECT_ROOT,
  process.env.ORGOPS_SKILL_ROOTS,
);
```

Pass `SKILL_ROOTS` and `discoverSkills` to `registerSkillsRoutes` and `registerEventsRoutes`. `/api/skills` returns the whole discovery object. Event-shape loading uses `discoverSkills(SKILL_ROOTS).skills` and preserves `ORGOPS_EVENT_SHAPES_CACHE_TTL_MS` behavior.

Do not add persistence, mutations, or a second endpoint.

- [ ] **Step 4: Run focused API tests and full API test file**

Run:

```bash
npx vitest run apps/api/src/app.test.ts -t "external skill|duplicate skill|external event shape"
npx vitest run apps/api/src/app.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add failing UI projection tests**

Define admin UI counterparts for `SkillRoot`, `SkillConflict`, `SkillRootDiagnostic`, and `SkillDiscovery`.

Test `SkillsScreen` with:

```tsx
<SkillsScreen
  skills={[externalSkill]}
  conflicts={[{ name: "duplicate", paths: ["/a/duplicate", "/b/duplicate"] }]}
  diagnostics={[{ path: "/missing", code: "MISSING" }]}
/>
```

Assert rendered output contains `External`, the external path, the duplicate name and both bounded paths, and the missing-root warning. Assert the conflict is not rendered as an available skill.

Add a `useOrgOpsData` or App-level fetch regression proving agent forms receive `response.skills`, not the entire response object.

- [ ] **Step 6: Run focused UI tests and verify RED**

Run:

```bash
npx vitest run apps/admin-ui/src/screens/SkillsScreen.test.tsx apps/admin-ui/src/App.test.tsx
```

Expected: FAIL because UI expects a bare array and warning props do not exist.

- [ ] **Step 7: Implement thin UI adaptation**

Store discovery state atomically:

```ts
type SkillDiscovery = {
  skills: SkillMeta[];
  conflicts: SkillConflict[];
  diagnostics: SkillRootDiagnostic[];
};
```

`refreshSkills` fetches this object, sets usable skills for existing selectors, and sets warning collections for the Skills screen. Render root kind/path on each skill and compact non-secret warning panels. Do not introduce filters, installation actions, source pages, or new navigation.

- [ ] **Step 8: Run API/UI verification**

Run:

```bash
npx vitest run apps/api/src/app.test.ts packages/skills/src/index.test.ts \
  apps/admin-ui/src/screens/SkillsScreen.test.tsx apps/admin-ui/src/App.test.tsx
npm run --workspace @orgops/api lint
npm run --workspace @orgops/admin-ui lint
```

Expected: tests PASS and no new workspace diagnostics.

- [ ] **Step 9: Commit Task 2**

```bash
git add apps/api/src/app.ts apps/api/src/routes/skills.ts apps/api/src/routes/events.ts \
  apps/api/src/app.test.ts apps/admin-ui/src/types.ts \
  apps/admin-ui/src/hooks/useOrgOpsData.ts apps/admin-ui/src/screens/SkillsScreen.tsx \
  apps/admin-ui/src/screens/SkillsScreen.test.tsx \
  apps/admin-ui/src/components/drawers/DashboardDrawers.tsx apps/admin-ui/src/App.tsx
git commit -m "feat(skills): expose external roots in existing UI"
```

Only stage the two prop-flow files if they changed.

---

### Task 3: Runner multi-root consumption and narrow write capability

**Files:**
- Modify: `apps/agent-runner/src/runner.ts`
- Modify: `apps/agent-runner/src/turn-executor.ts`
- Modify: `apps/agent-runner/src/turn-executor.test.ts`
- Modify: `apps/agent-runner/src/prompt.ts`
- Modify: `apps/agent-runner/src/prompt.test.ts`
- Create: `apps/agent-runner/src/private-skill-repository-access.ts`
- Create: `apps/agent-runner/src/private-skill-repository-access.test.ts`

**Interfaces:**
- Consumes: Task 1 `SkillRoot`, `SkillMeta`, `resolveSkillRoots`, and `discoverSkills`.
- Produces: turn executor input `skillRoots: SkillRoot[]`; pure `resolvePrivateSkillRepositoryAccess` interface from the file map; runner guidance accepts `skillRootPaths: string[]`.

- [ ] **Step 1: Add failing capability tests**

Create table-driven tests proving access succeeds only when all conditions hold:

```ts
expect(resolvePrivateSkillRepositoryAccess({
  selectedSkills: [canonicalBuiltInManagementSkill],
  roots: [builtInRoot, { path: "/srv/private/skills", kind: "EXTERNAL" }],
  repositoryPath: "/srv/private",
})).toEqual({ ok: true, skillsPath: resolve("/srv/private/skills") });
```

Failure cases:

- management skill absent;
- external skill with the same name attempts impersonation;
- management skill path is not exactly `<built-in-root>/private-skill-repository`;
- repository path is relative;
- `<repositoryPath>/skills` is not one configured external root;
- repository path or roots are absent.

Return bounded reason codes, not raw environment values.

- [ ] **Step 2: Run capability tests and verify RED**

Run:

```bash
npx vitest run apps/agent-runner/src/private-skill-repository-access.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure capability decision**

Use lexical `resolve`/`join` equality and canonical built-in identity. Do not use name alone and do not grant repository parent or `.git`.

```ts
export function resolvePrivateSkillRepositoryAccess(input: Input): Result {
  // locate BUILT_IN root
  // prove selected canonical management directory
  // prove absolute repositoryPath
  // prove resolved repositoryPath/skills equals one EXTERNAL root
  // return only that skills path
}
```

- [ ] **Step 4: Add failing runner/prompt tests**

Update turn fixtures to provide two roots. Prove an enabled external skill:

- appears in the skill index;
- preloads its `SKILL.md` when requested;
- contributes its event shape;
- contributes its exact skill directory to tool `extraAllowedRoots`.

Prove the canonical management skill adds the configured external root itself in addition to selected skill directories. Prove a duplicate discovered name cannot load.

Update prompt test expectation from one path to a sorted list:

```text
- Skills root folders:
  - /project/skills
  - /srv/private-skills/skills
```

- [ ] **Step 5: Run focused runner tests and verify RED**

Run:

```bash
npx vitest run apps/agent-runner/src/private-skill-repository-access.test.ts \
  apps/agent-runner/src/turn-executor.test.ts apps/agent-runner/src/prompt.test.ts
```

Expected: FAIL on singular `skillRoot`, old guidance, and absent management access.

- [ ] **Step 6: Implement runner root-set consumption**

In `runner.ts` resolve roots once from `PROJECT_ROOT` and `ORGOPS_SKILL_ROOTS`. Rename turn input from `skillRoot` to `skillRoots`. At each CLASSIC turn:

```ts
const discovery = discoverSkills(input.skillRoots);
const selectedSkills = discovery.skills.filter((skill) => enabled.has(skill.name));
const managementAccess = resolvePrivateSkillRepositoryAccess({
  selectedSkills,
  roots: input.skillRoots,
  repositoryPath: process.env.PRIVATE_SKILLS_REPO_PATH,
});
const extraAllowedRoots = [
  ...selectedSkills.map((skill) => skill.path),
  ...(managementAccess.ok ? [managementAccess.skillsPath] : []),
];
```

Use `extraAllowedRoots` in the existing tool context. Do not fail unrelated turns merely because an external root is missing; its diagnostic is visible through the API.

Pass all root paths to `buildRunnerGuidance`. Retain WRAPPED behavior unchanged.

- [ ] **Step 7: Run runner verification**

Run:

```bash
npx vitest run apps/agent-runner/src/private-skill-repository-access.test.ts \
  apps/agent-runner/src/turn-executor.test.ts apps/agent-runner/src/prompt.test.ts \
  apps/agent-runner/src/runner.test.ts
npm run --workspace @orgops/agent-runner lint
```

Expected: PASS and no new runner diagnostics.

- [ ] **Step 8: Commit Task 3**

```bash
git add apps/agent-runner/src/runner.ts apps/agent-runner/src/turn-executor.ts \
  apps/agent-runner/src/turn-executor.test.ts apps/agent-runner/src/prompt.ts \
  apps/agent-runner/src/prompt.test.ts \
  apps/agent-runner/src/private-skill-repository-access.ts \
  apps/agent-runner/src/private-skill-repository-access.test.ts
git commit -m "feat(runner): load skills from configured roots"
```

---

### Task 4: Deterministic repository-management helper

**Files:**
- Create: `skills/private-skill-repository/assets/repository-config.ts`
- Create: `skills/private-skill-repository/assets/repository-config.test.ts`
- Create: `skills/private-skill-repository/assets/git-process.ts`
- Create: `skills/private-skill-repository/assets/git-process.test.ts`
- Create: `skills/private-skill-repository/assets/skill-changes.ts`
- Create: `skills/private-skill-repository/assets/skill-changes.test.ts`
- Create: `skills/private-skill-repository/assets/manage-repository.ts`
- Create: `skills/private-skill-repository/assets/manage-repository.test.ts`

**Interfaces:**
- Consumes: environment configuration and ordinary Git executable.
- Produces: executable CLI commands `status`, `sync`, `begin`, `validate`, `publish`; structured JSON result `{ ok, operation, data? }` or `{ ok: false, operation, code, message }`.

- [ ] **Step 1: Add failing configuration tests**

Specify strict parsing:

```ts
const config = parseRepositoryConfig({
  PRIVATE_SKILLS_REPO_URL: "https://github.com/acme/private-skills.git",
  PRIVATE_SKILLS_REPO_PATH: absoluteRepo,
  PRIVATE_SKILLS_REPO_BRANCH: "main",
  ORGOPS_SKILL_ROOTS: join(absoluteRepo, "skills"),
});
expect(config).toEqual({
  repositoryUrl: "https://github.com/acme/private-skills.git",
  repositoryPath: resolve(absoluteRepo),
  skillsPath: resolve(absoluteRepo, "skills"),
  defaultBranch: "main",
});
```

Reject missing values, relative repository path, unsafe branch names, URL credentials/userinfo, and root mismatch. Accept the managed root among several platform-delimited roots.

- [ ] **Step 2: Run config tests and verify RED**

Run:

```bash
npx vitest run skills/private-skill-repository/assets/repository-config.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement strict configuration parsing**

Use a discriminated result or a typed `RepositoryError` carrying one bounded code. Never echo raw environment values in error messages. Branch validation permits normal Git branch characters but rejects whitespace, leading dash, `..`, `@{`, backslash, control characters, and trailing slash/dot/lock.

- [ ] **Step 4: Add failing changed-path validation tests**

Create temporary repositories/trees and test pure validation of supplied changed paths:

```ts
expect(validateChangedSkills(config, ["skills/demo/SKILL.md", "skills/demo/assets/run.ts"]))
  .toEqual({ ok: true, skillNames: ["demo"] });
```

Reject absolute paths, `..`, `.git`, any path outside `skills/`, missing/malformed frontmatter, and basename/name mismatch. Parse `git status --porcelain=v1 -z` so untracked files and both rename paths are included. Deletion of a complete skill directory is valid when Git reports only deleted paths under that directory. Empty change sets return a fixed `NO_CHANGES` error.

- [ ] **Step 5: Implement changed-path and skill validation**

Reuse `loadSkillMeta` for existing affected directories. Parse Git porcelain-v1 `-z` output without splitting on whitespace or newline; account for the extra NUL-delimited source path on rename/copy records. Validate both old and new paths. Return only bounded relative paths/skill names.

- [ ] **Step 6: Add failing Git process/authentication tests**

Inject a fake spawn adapter and temporary directory factory. Assert:

- every Git invocation is an argument array with `shell: false`;
- HTTPS token uses a temporary owner-only askpass file and environment variables, never command arguments or remote URL;
- token/username and temporary path are redacted from success/error output;
- temporary material is removed after exit 0, non-zero exit, spawn error, and timeout;
- absent token leaves normal host Git/SSH environment available while disabling interactive terminal prompts;
- stdout/stderr are capped and excess returns `GIT_FAILED` without unbounded content.

- [ ] **Step 7: Implement bounded Git execution**

Export a small injected factory:

```ts
type GitRunner = {
  run(args: string[], options?: { cwd?: string; timeoutMs?: number }): Promise<GitResult>;
};

createGitRunner({ env, spawnImpl, mkdtempImpl, rmImpl }): GitRunner;
```

Use `spawn("git", args, { shell: false, ... })`, fixed timeouts, output byte ceilings, `GIT_TERMINAL_PROMPT=0`, and `finally` cleanup. A temporary askpass helper prints username/password based on Git's prompt text; its path and content are never returned.

- [ ] **Step 8: Add failing command-orchestration tests with real local Git**

Create a temporary bare remote and seed repository. Execute the CLI orchestration through exported `runRepositoryCommand` with injected env/output and assert:

- `sync` clones an absent target at the configured branch;
- `sync` fetches and performs only fast-forward update on a clean existing checkout;
- `status` returns branch, clean, conflicted, ahead, and behind metadata without file contents;
- `begin --branch feature/x` starts only from synchronized clean default branch, creates an absent local branch, and switches to an existing matching local branch without rewriting it;
- `validate` accepts valid skill edits and rejects paths outside `skills/`;
- `publish --message ...` commits only allowed changes and pushes the review branch;
- `publish --direct --message ...` pushes the configured branch only when explicit;
- repository URL mismatch, dirty pre-sync, divergence, conflict, lock contention, invalid skill, and no changes each return their exact bounded code;
- no command invokes stash, rebase, reset, clean, or force push.

- [ ] **Step 9: Implement lock and command orchestration**

Use atomic `mkdir` for an adjacent lock such as `${repositoryPath}.orgops-private-skills.lock`. Mutating operations acquire it before inspecting mutable state and remove only the lock they created in `finally`. Existing locks return `BUSY`; never auto-delete them.

Implement command flow exactly:

```text
status  -> inspect only
sync    -> clean/unconflicted check -> origin identity -> fetch -> ff-only
begin   -> synchronized default -> git switch <existing> or git switch -c <new>
validate-> changed path scan -> structural skill validation
publish -> lock -> validate -> git add -- <validated paths> -> commit -> push
```

Clone validates parent availability before `git clone --branch <branch> --single-branch <url> <path>`. Existing checkout verifies normalized `remote.origin.url` equals configured URL without credentials.

The CLI prints one JSON object and sets exit code 0/1. It catches all internal errors and maps them to the bounded codes from the spec.

- [ ] **Step 10: Run all helper tests and lint**

Run:

```bash
npx vitest run skills/private-skill-repository/assets/*.test.ts
npm run --workspace @orgops/skills lint
```

If root TypeScript configuration does not include tracked skill assets, also run:

```bash
npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext \
  skills/private-skill-repository/assets/*.ts
```

Expected: all helper tests PASS; no unredacted fixture token appears in captured output.

- [ ] **Step 11: Commit Task 4**

```bash
git add skills/private-skill-repository/assets
git commit -m "feat(skills): add safe private repository helper"
```

---

### Task 5: Management instructions, operational docs, and end-to-end acceptance

**Files:**
- Create: `skills/private-skill-repository/SKILL.md`
- Create: `apps/agent-runner/src/private-skill-repository.integration.test.ts`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `apps/api/README.md`
- Modify: `apps/agent-runner/README.md`
- Modify: `docs/SPEC.md`

**Interfaces:**
- Consumes: all prior task interfaces and CLI commands.
- Produces: operator/agent instructions and one real boundary test from repository sync through discovery and runner access.

- [ ] **Step 1: Write the built-in skill document**

Use valid frontmatter whose name exactly matches the directory:

```md
---
name: private-skill-repository
description: Synchronize and publish skills in the configured private Git repository.
---
```

The body must instruct the agent to:

1. run `status` before mutation;
2. run `sync` before editing;
3. use `begin --branch ...` for the default review workflow;
4. edit only `$PRIVATE_SKILLS_REPO_PATH/skills`;
5. run `validate` before publication;
6. use review publication by default and `--direct` only after explicit human instruction;
7. stop and report `BUSY`, dirty, divergence, conflict, repository mismatch, auth failure, or invalid skill rather than improvising destructive Git commands;
8. never print secrets or rewrite credential configuration.

Show exact invocation using the current skill directory path from the runner skill index:

```bash
node --import tsx <skill-path>/assets/manage-repository.ts status
```

Do not claim that synchronization automatically enables a skill.

- [ ] **Step 2: Add a failing end-to-end boundary test**

Use a temporary project root, private checkout path, and local bare Git remote. Exercise:

1. API-style `resolveSkillRoots` + `discoverSkills` initially reports the external root missing.
2. Management helper `sync` creates the checkout.
3. Discovery immediately returns the private skill.
4. `resolvePrivateSkillRepositoryAccess` grants the external `skills/` root only for the canonical built-in management skill.
5. A simulated next turn can preload the private skill and load its event shape.
6. A duplicate built-in/private name removes both from usable discovery.

Keep the test local/offline; never require GitHub credentials or network.

- [ ] **Step 3: Run the end-to-end test and verify RED**

Run:

```bash
npx vitest run apps/agent-runner/src/private-skill-repository.integration.test.ts
```

Expected: FAIL until the SKILL path, helper entry point, and all boundary integrations line up.

- [ ] **Step 4: Complete integration fixes without widening scope**

Fix only interface mismatches found by the boundary test. Do not add repository persistence, UI management controls, background jobs, or automatic enablement.

- [ ] **Step 5: Document exact installation and security behavior**

Add to `.env.example`:

```env
# Optional platform-delimited absolute directories containing additional skills.
ORGOPS_SKILL_ROOTS=
# One repository managed by the private-skill-repository skill.
PRIVATE_SKILLS_REPO_URL=
PRIVATE_SKILLS_REPO_PATH=
PRIVATE_SKILLS_REPO_BRANCH=main
```

Document in root/API/runner READMEs:

- API and runner need matching root configuration in v1;
- built-in and private repositories remain separate checkouts;
- agent-private secret `PRIVATE_SKILLS_GIT_TOKEN` and optional username;
- host SSH/credential-helper fallback;
- management skill enablement and narrow write root;
- host Git author name/email must already be configured for commits;
- next-`GET /api/skills`/next-CLASSIC-turn refresh (WRAPPED turns bypass skill discovery);
- duplicate names unavailable;
- split-host synchronization is operator-owned.

Update `docs/SPEC.md` runtime/API contracts and explicitly state that `/api/skills` now returns `{ skills, conflicts, diagnostics }`.

- [ ] **Step 6: Run focused feature verification**

Run:

```bash
npx vitest run packages/skills/src/index.test.ts \
  apps/api/src/app.test.ts \
  apps/admin-ui/src/screens/SkillsScreen.test.tsx \
  apps/admin-ui/src/App.test.tsx \
  apps/agent-runner/src/private-skill-repository-access.test.ts \
  apps/agent-runner/src/private-skill-repository.integration.test.ts \
  apps/agent-runner/src/turn-executor.test.ts \
  apps/agent-runner/src/prompt.test.ts \
  skills/private-skill-repository/assets/*.test.ts
```

Expected: all selected tests PASS.

- [ ] **Step 7: Run repository release gates**

Run:

```bash
npm test
npm run lint
npm run build
npm run --workspace @orgops/opscli test
git diff --check origin/main...HEAD
git status --short
```

Expected:

- all root tests PASS;
- lint introduces no diagnostics;
- admin and user UI builds PASS;
- Ops CLI tests PASS;
- diff check is clean;
- no staged or unrelated files remain.

- [ ] **Step 8: Commit Task 5**

```bash
git add skills/private-skill-repository/SKILL.md \
  apps/agent-runner/src/private-skill-repository.integration.test.ts \
  .env.example README.md apps/api/README.md apps/agent-runner/README.md docs/SPEC.md
git commit -m "docs(skills): document private repository workflow"
```

- [ ] **Step 9: Request final code review**

Review `origin/main..HEAD` specifically for:

- accidental catalog/agent-template scope;
- token leakage;
- external-skill path traversal;
- management-skill impersonation;
- duplicate-name silent precedence;
- destructive Git recovery;
- UI/API contract mismatches;
- split-host claims that exceed v1.

Resolve all Critical and Important findings, rerun affected tests, then rerun `npm test` before integration.

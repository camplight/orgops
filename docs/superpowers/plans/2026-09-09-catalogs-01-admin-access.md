# Catalogs Phase 1: Administrator Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended when an actual subagent tool is available) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Establish a persisted human administrator designation and a reusable API guard before exposing privileged catalog operations.

**Architecture:** Add a deny-by-default `humans.is_admin` flag. Fresh installations designate only their seeded human administrator; upgraded installations require an explicit operator action against a known human ID. Authorization consults the database on each protected request rather than trusting usernames or cached session roles.

**Tech Stack:** Existing TypeScript, Hono, better-sqlite3, Drizzle, Vitest and npm workspaces; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md`, especially §10.

## Global Constraints

- Admin-only catalog management, installation, template instantiation and publishing in v1.
- Agents, regular humans and runner credentials cannot authorize these management operations.
- A general role editor/RBAC system is outside scope.
- The API remains the database owner; no live database changes from a new online management CLI.
- Hand-write numbered SQL migrations and matching Drizzle schema changes.
- No credentials or live instance configuration are required to implement this phase.
- Preserve existing authentication/visibility semantics outside the new protected catalog surface, except the owner-approved administrator-target temporary-password reset protection described below.

## Execution status and approved bootstrap policy

The user has authorized implementation and explicitly approved the administrator bootstrap/migration policy:

1. New database: the existing seed path creates its initial human with `is_admin = 1`.
2. Existing database: all existing humans migrate to `is_admin = 0`; do not promote by username or assume the oldest human is an administrator.
3. An operator explicitly promotes a selected human ID using the maintenance SQL procedure below with the API stopped. No new role-management endpoint or general RBAC UI.
4. Role changes take effect on the next privileged request, without requiring a new login.

The bootstrap review gate is satisfied. Do not run the maintenance procedure against real instance data during implementation.

## Scope and later phases

This plan implements only the administrator prerequisite, not the entire catalog feature. Each subsequent phase gets its own concrete plan after inspecting its affected modules:

| Phase | Independently testable result | Dependency |
| --- | --- | --- |
| 1 — this plan | persisted admin identity, fail-closed guard and migration guidance | none |
| 2 — package contract | parse/validate/export all package kinds, digest/path checks and pinned dependencies | approved spec |
| 3 — catalog discovery | admin-managed public/private Git sources, protected credential storage and inert cached inspection | 1, 2 |
| 4 — installation | staged API/runner delivery, local bindings, approved activation, start gates and recovery | 1–3 |
| 5 — GitHub publishing | allowlisted export previews, repository-scoped PAT, branch/PR submission and retry reconciliation | 1–3; local-origin integration from 4 |
| 6 — operator UI and end-to-end | configured catalogs, previews, import/publish flows and two-instance acceptance scenario | 1–5 |

Do not claim the later phases are executable plans yet. Phase 2 and phase 1 could be delegated independently if subagents become available; installation must wait for their contracts. Use fresh implementer/reviewer agents when available, otherwise run the same checkpoints inline and do not imply independent review occurred.

## File responsibilities

- `packages/db/migrations/031_human_admin.sql`: persisted deny-by-default designation.
- `packages/db/src/schema.ts`: matching Drizzle column.
- `apps/api/src/admin-access.ts`: pure decision and Hono middleware factory, with injected human lookup.
- `apps/api/src/admin-access.test.ts`: all authority/identity/password-update cases.
- `apps/api/src/admin-access.integration.test.ts`: migrated database, application seeding and session behavior.
- `apps/api/src/app.ts`: seed designation and compose the guard with the real database lookup.
- `apps/api/src/routes/auth.ts`: add current `isAdmin` to `/api/auth/me`, without caching it in sessions.
- `docs/SPEC.md`: implemented API/model changes and safe upgrade procedure.

No public admin probe endpoint. Guard behavior is verified using a small test-only Hono app, then reused by catalog routes in phase 3.

### Task 1: Persist administrator designation and test upgrade behavior

**Files:** Create `packages/db/migrations/031_human_admin.sql`, create `apps/api/src/admin-access.integration.test.ts`; modify `packages/db/src/schema.ts` and the seed block in `apps/api/src/app.ts`.

**Interfaces:** Produces `schema.humans.is_admin: integer`, constrained to 0 or 1, default 0. `createApp` keeps its existing interface and initial-human-only seeding behavior.

- [x] Write failing integration tests using the real in-memory SQLite database and existing `migrate`/`createApp` helpers:

```ts
import { describe, expect, it } from "vitest";
import { openDb, migrate } from "@orgops/db";
import { createApp } from "./app";

describe("administrator designation", () => {
  it("marks only the fresh installation's seeded human as administrator", () => {
    const db = openDb(":memory:");
    try {
      createApp({ db, adminUser: "bootstrap-owner", adminPass: "password" });
      expect(db.prepare("SELECT username, is_admin FROM humans").all())
        .toEqual([{ username: "bootstrap-owner", is_admin: 1 }]);
    } finally { db.close(); }
  });

  it("does not promote an existing human even when its name matches adminUser", () => {
    const db = openDb(":memory:");
    try {
      migrate(db);
      db.prepare(`INSERT INTO humans
        (id, username, password_hash, must_change_password, created_at, updated_at)
        VALUES (?, ?, ?, 0, 1, 1)`).run("human-existing", "admin", "not-a-login-hash");
      createApp({ db, adminUser: "admin", adminPass: "password" });
      expect(db.prepare("SELECT id, is_admin FROM humans").all())
        .toEqual([{ id: "human-existing", is_admin: 0 }]);
    } finally { db.close(); }
  });
});
```

- [x] Run `npx vitest run apps/api/src/admin-access.integration.test.ts`; verify failures come from the absent column/designation.
- [x] Add the numbered migration (check the next unused number again at execution time):

```sql
ALTER TABLE humans ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0
  CHECK (is_admin IN (0, 1));
```

- [x] Add the Drizzle field next to `must_change_password`:

```ts
is_admin: integer("is_admin").notNull().default(0),
```

- [x] Set `is_admin: 1` only inside the existing `if (!existingHuman)` seed insert. Do not add a username-based update or startup backfill.
- [x] Add an actual pre-migration fixture test: create a temporary migration directory, copy every committed migration preceding `031_human_admin.sql` there with `copyFileSync`, run `migrate(db, temporaryDirectory)`, insert an existing human, run normal `migrate(db)`, and assert its role remains 0. Repeat `migrate(db)` and assert no duplicate migration row. Use `mkdtempSync`, `tmpdir`, and `rmSync(..., { recursive: true, force: true })` in `finally` for cleanup.
- [x] Run the focused tests and `npx vitest run apps/api/src/app.test.ts -t "does not inject admin"`.
- [x] Review migration/schema parity and commit only these changes: `feat(auth): persist explicit human administrator designation`.

### Task 2: Add a fail-closed administrator guard

**Files:** Create `apps/api/src/admin-access.ts` and `apps/api/src/admin-access.test.ts`.

**Interfaces:**

```ts
import type { MiddlewareHandler } from "hono";
export type AdminPrincipal = {
  id?: string;
  username?: string;
  runnerScope?: unknown;
};
export type AdminHuman = { isAdmin: boolean; mustChangePassword: boolean };
export type AdminAccessDeps = {
  findHuman: (id: string) => AdminHuman | undefined;
};
export function canManageCatalogs(
  principal: AdminPrincipal | undefined,
  deps: AdminAccessDeps,
): boolean;
export function createRequireAdmin(deps: AdminAccessDeps): MiddlewareHandler;
```

Consumes the persisted human designation from task 1 via the injected lookup. Does not parse bearer tokens or invent a second session system; apply after existing authentication. A real human's username is not used as an authority check, including a human named `runner`.

- [x] Write a table-driven failing test for absent principal, missing ID, missing database row, ordinary human, administrator, forced-password-change administrator, and a runner-scoped principal with a forged human ID:

```ts
import { expect, it } from "vitest";
import { canManageCatalogs, type AdminPrincipal } from "./admin-access";

it.each<[AdminPrincipal | undefined, boolean]>([
  [undefined, false],
  [{ username: "runner" }, false],
  [{ id: "missing" }, false],
  [{ id: "ordinary", username: "admin" }, false],
  [{ id: "owner", username: "renamed-owner" }, true],
  [{ id: "owner", username: "runner" }, true],
  [{ id: "rotate-password" }, false],
  [{ id: "owner", runnerScope: { mode: "GLOBAL" } }, false],
])("checks persisted human authority for %j", (principal, expected) => {
  const findHuman = (id: string) => ({
    owner: { isAdmin: true, mustChangePassword: false },
    ordinary: { isAdmin: false, mustChangePassword: false },
    "rotate-password": { isAdmin: true, mustChangePassword: true },
  } as Record<string, { isAdmin: boolean; mustChangePassword: boolean }>)[id];
  expect(canManageCatalogs(principal, { findHuman })).toBe(expected);
});
```

- [x] Run `npx vitest run apps/api/src/admin-access.test.ts` and verify the expected missing-module failure.
- [x] Implement the decision and middleware:

```ts
export function canManageCatalogs(
  principal: AdminPrincipal | undefined,
  deps: AdminAccessDeps,
): boolean {
  if (!principal?.id || principal.runnerScope !== undefined) return false;
  const human = deps.findHuman(principal.id);
  return human?.isAdmin === true && human.mustChangePassword === false;
}

export function createRequireAdmin(deps: AdminAccessDeps): MiddlewareHandler {
  return async (c, next) => {
    if (!canManageCatalogs(c.get("user"), deps)) {
      return c.json({ error: "Administrator access required" }, 403);
    }
    await next();
  };
}
```

- [x] Add a middleware test with a test-only Hono route, mutable role lookup and an existing principal. Verify initial 200, demotion followed by 403, and that the protected handler is not called on denial. Add a lookup-exception test to verify the protected handler is never called when the role lookup fails; do not convert errors to permission grants.
- [x] Run focused tests; review that username equality, runner headers and cached session role cannot grant access.
- [x] Commit: `feat(auth): add database-backed administrator guard`.

### Task 3: Expose current capabilities and document safe bootstrap

**Files:** Modify `apps/api/src/app.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/admin-access.integration.test.ts`, `docs/SPEC.md`.

**Interfaces:** `GET /api/auth/me` gains `isAdmin: boolean`. Define and inject `canManageCatalogs: (principal: AdminPrincipal | undefined) => boolean` in `AuthDeps`; keep session records unchanged. The composition root supplies this function using the task-2 decision and a live lookup of the current human row. Approved Task 3 deviation: a typed, parameterized better-sqlite3 statement replaces the illustrative ORM lookup below, avoiding two new diagnostics from existing duplicate Drizzle nominal types without casts or dependency changes; see the execution ledger. Exported `createRequireAdmin` is the seam later catalog route composition uses; do not add an unused production probe route.

- [x] Write a failing application test: create an in-memory app, log in as the freshly seeded human, extract the `orgops_session` cookie from `set-cookie`, request `/api/auth/me`, and assert `isAdmin === true`.
- [x] In the same test, set that human's `is_admin = 0` using the test database, reuse the cookie and assert `isAdmin === false`. Also test runner-header `/api/auth/me` returns false and regular human returns false. Use explicit test credentials rather than reading developer credentials.
- [x] Run `npx vitest run apps/api/src/admin-access.integration.test.ts` to observe missing `isAdmin` failures.
- [x] Compose the real lookup in `app.ts` (completed using the approved typed SQL seam above; original illustrative ORM form retained here):

```ts
const adminAccessDeps = {
  findHuman: (id: string) => {
    const row = orm.select({
      isAdmin: schema.humans.is_admin,
      mustChangePassword: schema.humans.must_change_password,
    }).from(schema.humans).where(eq(schema.humans.id, id)).get();
    return row ? {
      isAdmin: row.isAdmin === 1,
      mustChangePassword: row.mustChangePassword === 1,
    } : undefined;
  },
};
```

Pass `(principal) => canManageCatalogs(principal, adminAccessDeps)` into `registerAuthRoutes` as the new dependency. In `/api/auth/me`, include `isAdmin: canManageCatalogs(user)` in the JSON response. Follow the existing dependency injection convention; `auth.ts` must not open the database.

- [x] Update `docs/SPEC.md` with the persisted designation, new `/api/auth/me` field, deny-by-default upgrade behavior and this operator-only procedure:

```text
Stop the API before maintenance. Back up the instance SQLite database using
SQLite's backup mechanism. Open the configured instance database, not an assumed
relative path. Confirm the intended human ID and username:
  SELECT id, username, is_admin FROM humans;
Within a transaction, promote exactly that ID with a bound parameter:
  BEGIN IMMEDIATE;
  UPDATE humans SET is_admin = 1 WHERE id = :selected_human_id;
  SELECT changes();
Commit only if exactly one row changed and re-reading it confirms the intended
identity; otherwise roll back. Restart the API. Verify /api/auth/me for that
human. Do not promote all users or infer authority from a matching username.
```

This is documentation only; do not execute it against the user's database. Document demotion through the same offline operator procedure with `is_admin = 0` and the requirement to preserve a known administrator when access is needed.

- [x] Run `npx vitest run apps/api/src/admin-access.test.ts apps/api/src/admin-access.integration.test.ts apps/api/src/app.test.ts`, then `npm run lint` and `git diff --check`. Report unrelated baseline failures instead of hiding them.
- [x] Review both requirements and code quality; explicitly report inline review if no independent subagent is available.
- [x] Commit: `feat(auth): expose administrator capability and document upgrade bootstrap`.

## Owner-approved final fixes

Owner approval ("its not critical but fix it - sounds okay") supersedes the final
review's previous authorization hold. Fix base: `485a54a0e8409de94530fcaff515d177a2ba9043`.

- [x] Protect `POST /api/humans/:id/reset-temp-password` for currently designated administrator targets using the shared live human capability injected from `app.ts`. Deny regular humans, both runner scopes (also with an admin cookie), live-demoted callers and callers requiring password rotation before changing/disclosing credentials.
- [x] Preserve target designation and forced rotation after authorized reset; leave non-admin-target policy and normal self-profile password changes unchanged. No role/recovery endpoint or general RBAC change. Recovery guidance is in `docs/SPEC.md`.
- [x] Add real API/in-memory database regressions with initial RED and focused GREEN evidence, including scoped invite/redeem credentials, live target role changes and unchanged credentials on denial.
- [x] Isolate `ORGOPS_OPSCLI_TOOL_LOOP_MAX_STEPS` before loading the opscli test bundle and restore it in cleanup; retain the 140 step-cap and runtime assertions. Reproduce RED and verify GREEN with external value 23.
- [x] Fresh full verification: Vitest 21 files / 198 tests and opscli 3/3 with default and external step-limit environments pass. Root lint remains RED: API 486 + runner 2 established diagnostics; ten other workspaces pass. Comparison adds/removes zero diagnostics after only the approved two union-order substitutions and line-shift normalization. `git diff --check` passes; dependencies unchanged.
- [x] Fresh independent review of these fixes and introduced regressions: reviewer `1d098c9e-ceaf-43e0-9129-8889117a65c0` approved spec compliance and code quality at `9ad192ed7f3fa7d92e5000f2e85adb6a5b6be19f`; both final findings addressed, no new blockers.

Raw RED/GREEN logs, lint comparison, local commit and fix-only package outcomes:
`.superpowers/sdd/2026-09-09-catalogs-01-admin-access/approved-final-fix-report.md`.

## Phase completion gate

Phase 1 is complete under the documented existing-lint-debt exception, not an all-green repository claim. The whole-phase review `bd23228f-71d1-4965-a57b-10f80d9ac473` verified Tasks 1–3 and found the two final issues; scoped independent re-review `1d098c9e-ceaf-43e0-9129-8889117a65c0` approved their fixes at `9ad192ed7f3fa7d92e5000f2e85adb6a5b6be19f`. Actual structured verdicts were used; commentary-only Markdown files were not treated as approvals.

Parent verification on that head: Vitest 198/198; opscli 3/3 with defaults and external step limit 23; cumulative diff checks pass. Root lint still exits 2 with 486 API diagnostics before short-circuiting; independent all-workspace evidence records 488 established diagnostics total with zero additions/removals after the documented normalization. Dependencies and tracked/index state are unchanged by verification.

Evidence: `.superpowers/sdd/2026-09-09-catalogs-01-admin-access/approved-final-fix-review.md`, `approved-final-fix-report.md`, and `parent-final-{vitest,opscli,opscli-override,lint}.log`. Retain local evidence while lint debt remains unresolved; no remote publication or worktree cleanup was performed.

- [x] Whole-phase review including Task 3 and approved final-fix re-review recorded.

- [x] Migration tested on fresh and pre-migration databases; no existing human silently promoted.
- [x] Runner identity never gains catalog management authority; renamed humans retain persisted authority.
- [x] Demotion/password-update requirements reflected immediately rather than through stale sessions.
- [x] API contract and operator upgrade guidance match implementation.
- [x] Focused tests and workspace type checks have fresh recorded results.
- [x] No catalog feature or subagent execution claimed complete by this prerequisite alone.

After required independent review approval and a concrete approved plan, continue with phase 2 (package contract). Do not expand this phase into catalog routes, credential storage or a general role-management UI.

### Baseline lint policy — supervisor-approved recovery continuation

Established pre-existing lint failures are non-blocking for implementation; newly introduced diagnostics or inability to distinguish them are blockers. Final completion must explicitly disclose lint remains red. This exception applies to known test/typecheck debt, not subagent infrastructure failures. Compare normalized file/code/message diagnostics against `.superpowers/sdd/2026-09-09-catalogs-01-admin-access/continued-lint-baseline.json` and fix added errors; request supervisor help for a new load-bearing type issue. Root lint short-circuits, so use individual workspace results as well. Do not hide errors through casts/aliases, manually dedupe, change production authorization, or alter dependencies/lockfile. Independent review remains required; this policy does not suppress reviewer findings.

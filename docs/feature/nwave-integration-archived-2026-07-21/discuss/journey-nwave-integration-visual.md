# Journey: nWave Integration — Visual (nwave-integration)

## Framing Note

This is not a classic end-user product journey. OrgOps is a working, shipped, multi-host agent system (`docs/SPEC.md`, `docs/use-cases.md` already describe its five real use cases). `nwave-integration` is the work of adopting the nWave methodology going forward — formalizing that already-shipped architecture into nWave's SSOT doc model (`docs/product/`) so future OrgOps feature work can flow through the wave pipeline instead of starting from a blank slate each time.

There is no end user experiencing a UI here. The "journey" below maps the experience of the OrgOps maintainer (and the nWave agents that act on their behalf, e.g. solution-architect in DESIGN) doing this one-time bootstrap. Per the discovery methodology's emotional-arc requirement, we track a **process confidence arc** rather than inventing product delight/frustration that doesn't exist for this kind of work — that gap is noted explicitly rather than padded with invented emotion.

## Persona

**Priya Raman** — engineering lead at OrgOps, owns `apps/agent-runner` and the event-bus subsystem. Wants the next real feature (e.g. "add a `daemon` wrapper harness kind" or "add priority queues to event delivery") to run through nWave's DESIGN/DISTILL/DELIVER waves grounded in the actual shipped architecture, not a re-derivation of it from scratch.

**Secondary persona**: the **solution-architect** (nWave agent) who, on the next feature's DESIGN wave, needs `docs/product/architecture/brief.md` to exist so it can extend rather than recreate architecture context.

## Trigger

Priya decides to start using nWave for OrgOps's next feature. She runs `/nw-design` (or `/nw-diverge`), and the wave's migration/bootstrap gate reports `docs/product/` does not exist. That gap is the trigger: it has to be closed before real feature work benefits from nWave's SSOT model.

## Emotional Arc (Process Confidence, not classic UX delight)

| Phase | Feeling | Why |
|---|---|---|
| Start | Uncertain | `docs/SPEC.md` and `docs/use-cases.md` are accurate but unstructured for nWave's per-wave-owner SSOT model (brief.md sections, ADRs, journeys). Priya isn't sure what counts as an "architectural decision" worth an ADR vs. routine implementation detail. |
| Middle | Methodical | Walking `SPEC.md` section by section, cross-checking against real source (e.g. `apps/agent-runner/src/wrapped-runtime.ts`), sorting content into brief.md narrative vs. ADR-worthy decisions vs. "leave in SPEC.md, link don't duplicate." |
| End | Confident / unblocked | `docs/product/` exists; the next feature's DESIGN wave reads `brief.md` + ADRs on the first pass with no missing-file gate failures; the team has an explicit, written rule that future OrgOps features skip DISCOVER (product-market fit already established) and start at DISCUSS or DESIGN. |

No jarring transitions: uncertainty resolves gradually as each artifact lands, not in one big reveal.

## Flow (ASCII)

```
[Trigger: /nw-design reports        [Step 1: Inventory         [Step 2: Formalize          [Step 3: Capture
 docs/product/ missing]        -->    existing knowledge]  -->   architecture SSOT]    -->   undocumented decisions
                                                                                              as ADRs]
  Feels: uncertain                    Feels: methodical          Feels: methodical           Feels: methodical,
  Sees: migration/bootstrap           Sees: SPEC.md (495         Sees: brief.md taking        gaining confidence
  gate message                        lines), use-cases.md       shape section by section     Sees: adr-001..00N,
                                       (5 use cases), source      (stack, data model,          each with Context/
                                       code cross-checks          event contract, agent        Decision/Consequences
                                                                  modes, runner tooling)

        |
        v

[Step 4: Define routing        [Step 5: Validate SSOT
 rules for future features] -->  readiness with next
                                  real feature's DESIGN
                                  wave dry run]

  Feels: decisive                Feels: confident, unblocked
  Sees: wave-decisions.md        Sees: DESIGN wave's reading-
  stating "future OrgOps          enforcement checklist all
  features skip DISCOVER,         green (all files read, zero
  start at DISCUSS or             missing-file markers)
  DESIGN"
```

## Step Mockups

### Step 0 (Trigger): Migration/Bootstrap Gate Fires

```
+-- /nw-design nwave-integration -------------------------------+
| Reading SSOT architecture...                                   |
| MISSING docs/product/architecture/brief.md (not found)         |
| MISSING docs/product/architecture/adr-*.md (none found)        |
|                                                                  |
| docs/product/ does not exist. docs/feature/ has no prior        |
| features either -- this is greenfield from nWave's perspective. |
| Proceeding: DESIGN will bootstrap docs/product/architecture/.   |
+------------------------------------------------------------------+
```

### Step 1: Inventory Existing Knowledge

```
+-- Manual review ------------------------------------------------+
| docs/SPEC.md            495 lines  -- stack, data model,        |
|                                       event contract, API        |
|                                       surface, env vars           |
| docs/use-cases.md        35 lines  -- 5 real use cases            |
| apps/agent-runner/src/*            -- ground truth for WRAPPED   |
|                                       runtime behavior            |
+--------------------------------------------------------------------+
Priya's mental model check: "Which of this is a *decision* someone
could have made differently (ADR-worthy), and which is just 'how it
currently works' (brief.md narrative)?"
```

### Step 2: Formalize Architecture SSOT

```
+-- docs/product/architecture/brief.md (excerpt) ------------------+
| ## System Context                                                 |
| OrgOps: Node.js multi-host agent system, humans + agents          |
| collaborate over an event bus persisted in SQLite.                |
|                                                                     |
| ## Component Architecture                                          |
| apps/api | apps/agent-runner | apps/opscli | apps/ui               |
| packages/crypto | packages/db | packages/event-bus | packages/llm  |
| packages/schemas | packages/skills                                 |
|                                                                      |
| ## Agent Execution Modes                                            |
| CLASSIC | RLM_REPL | WRAPPED (external runtime delegation)           |
+------------------------------------------------------------------------+
```

### Step 3: Capture Undocumented Decisions as ADRs

```
+-- docs/product/architecture/adr-001-wrapped-agent-mode.md --------+
| # ADR-001: WRAPPED Agent Mode Delegates Turn Handling to External |
|            Runtimes                                               |
|                                                                     |
| ## Context                                                          |
| Some agents (OpenClaw, Codex-based) already have their own          |
| session/memory/tool/model machinery. Forcing them through            |
| OrgOps's native CLASSIC prompt-composition pipeline would            |
| duplicate that machinery and fight the external runtime's own        |
| conventions.                                                          |
|                                                                        |
| ## Decision                                                            |
| WRAPPED agents skip OrgOps memory summaries, prompt composition,       |
| skills, and native model calls. The wrapper harness                    |
| (apps/agent-runner/src/wrapper-harness/) owns setup/session/turn       |
| handling; OrgOps only tracks lifecycle state and normalizes            |
| output into message.created events.                                     |
|                                                                            |
| ## Consequences                                                            |
| + External runtimes (OpenClaw etc.) integrate without OrgOps            |
|   reimplementing their internals.                                        |
| - allow_outside_workspace and native soul fields don't apply to          |
|   WRAPPED agents; creators must translate them into harness config.       |
+--------------------------------------------------------------------------+
```

### Step 4: Define Routing Rules for Future Features

```
+-- docs/feature/nwave-integration/discuss/wave-decisions.md -------+
| ## Key Decisions                                                    |
| [D4] Future OrgOps features skip DISCOVER by default: product-      |
|      market fit is already established (working, in-production      |
|      brownfield system with 5 documented use cases). Features        |
|      start at DISCUSS (if requirements need discovery) or             |
|      directly at DESIGN (if requirements are already clear).           |
+---------------------------------------------------------------------+
```

### Step 5: Validate SSOT Readiness (Dry Run)

```
+-- /nw-design {next-real-feature-id} ------------------------------+
| Reading SSOT architecture...                                        |
| OK docs/product/architecture/brief.md                                |
| OK docs/product/architecture/adr-001-wrapped-agent-mode.md            |
| OK docs/product/architecture/adr-002-event-bus-at-least-once.md        |
| OK docs/product/architecture/adr-003-sqlite-drizzle.md                  |
|                                                                           |
| No missing-file gates. Extending brief.md under                          |
| ## Application Architecture rather than recreating system context.        |
+----------------------------------------------------------------------------+
```

## Shared Artifacts (see registry for full detail)

- `docs/SPEC.md` — existing source; feeds brief.md content, remains link target for implementation detail
- `docs/use-cases.md` — existing source; feeds brief.md's System Context / capability narrative
- `docs/product/architecture/brief.md` — new SSOT; created by DESIGN wave off this feature's requirements
- `docs/product/architecture/adr-*.md` — new SSOT; created by DESIGN wave off this feature's requirements
- `docs/feature/nwave-integration/discuss/wave-decisions.md` — routing-rule decision consumed by future DISCUSS/DIVERGE/DESIGN migration-gate checks

## Error / Friction Paths

1. **Brief.md becomes a duplicate of SPEC.md instead of an index.** Recovery: DESIGN wave review flags duplication (any verbatim block >3 lines); brief.md is rewritten to summarize + link, not copy.
2. **A real architectural decision (e.g. "why SQLite not Postgres") is captured nowhere** because it predates nWave and nobody remembers to write the ADR. Recovery: US-02's UAT requires walking SPEC.md for decision-shaped statements ("chose X over Y because Z") and demands an ADR — or an explicit recorded deferral — for each one found; gaps become explicit red-card questions, not silent omissions.
3. **Next feature's DESIGN wave still hits missing-file gates** because brief.md was structured wrong (e.g. missing a heading solution-architect expects). Recovery: US-04's dry-run step exists specifically to catch this before declaring the bootstrap done.

## Changed Assumptions

None. No DISCOVER or DIVERGE artifacts exist for this feature-id (confirmed absent, by design — see `wave-decisions.md`), so there are no prior assumptions to reconcile.

<!-- markdownlint-disable MD024 -->
# User Stories: nwave-integration

## System Constraints

Cross-cutting constraints that apply to every story in this feature:

- **Brownfield, not greenfield**: OrgOps is a working, shipped, in-production multi-host agent system. Nothing here changes runtime behavior — every story produces or shapes *documentation* (`docs/product/`), not application code.
- **JTBD skipped for this feature**: the user explicitly confirmed this is not a case of competing end-user motivations — the "job" is internal (enable future OrgOps development work to flow through nWave), not something JTBD's four-forces/emotional-arc machinery is built to untangle. Every story below states `Job Traceability: JTBD skipped` instead of a job-story reference, per the JTBD-BDD integration rule for when Decision 4 = No.
- **No DISCOVER/DIVERGE artifacts exist** for this feature-id, by design (see `wave-decisions.md`) — OrgOps's product-market fit is already established by virtue of being a working, in-production system with 5 documented use cases (`docs/use-cases.md`).
- **Single-source-of-truth discipline**: no story may duplicate content verbatim from `docs/SPEC.md` or `docs/use-cases.md` into `docs/product/`. Every story's acceptance criteria include a check against duplication drift.
- **Walking skeleton: not applicable** — confirmed decision for this feature; these are documentation/process stories, not runtime feature slices.

---

## US-01: Formalize Shipped Architecture into the SSOT Brief

### Problem

Priya Raman, OrgOps's engineering lead, wants the next real OrgOps feature (e.g. "add a `daemon` wrapper harness kind") to run through nWave's DESIGN wave grounded in the actual shipped architecture. Today, that architecture lives only as 495 lines of prose in `docs/SPEC.md` — there is no `docs/product/architecture/brief.md`. Every time a DESIGN wave runs, solution-architect would have to re-read `SPEC.md` cold and cross-reference source code to reconstruct component boundaries, the data model, and the event contract, instead of extending an existing, structured SSOT document.

### Who

- OrgOps engineering lead (Priya Raman) | initiating the feature that adopts nWave | wants future DESIGN waves to start from documented context, not code archaeology
- solution-architect (nWave agent, secondary/consuming persona) | runs the next feature's DESIGN wave | needs `brief.md` structured with the headings other architects and later waves expect (`## System Context`, `## Component Architecture`, `## Application Architecture`, etc.)

### Job Traceability

JTBD skipped (per confirmed feature-level decision — see System Constraints above).

### Solution

Formalize `docs/SPEC.md`'s architectural content (stack, monorepo layout, core data model, agent execution modes, event contract) into `docs/product/architecture/brief.md`, written as a summary that links back to `docs/SPEC.md` for exhaustive implementation detail (full API surface, all 39 environment variables) rather than duplicating it.

### Domain Examples

1. **Happy path** — Priya runs `/nw-design` for a new feature ("add a `daemon` wrapper harness kind"); solution-architect reads `docs/product/architecture/brief.md` and finds the Node.js/Hono/SQLite+Drizzle stack, the `apps/*`/`packages/*` monorepo layout, and the event envelope contract (`type`, `payload`, `source`, `channelId`, `parentEventId`, `deliverAt`, `idempotencyKey`) already documented — no need to re-derive any of it from `SPEC.md`.
2. **Edge case** — Marcus Webb, a contributor adding a fourth agent execution mode in the future, reads `brief.md`'s `## Agent Execution Modes` section and sees `CLASSIC`, `RLM_REPL`, and `WRAPPED` already documented with their responsibility boundaries, so he can see where a new mode should slot in without re-reading all of `apps/agent-runner`'s source.
3. **Boundary/error case** — During review, Priya notices `brief.md`'s draft copied all 39 environment variables from `SPEC.md` verbatim into a table. She flags it: the table is deleted and replaced with a one-line link ("full environment variable reference: `docs/SPEC.md#environment-variables-implemented`"), because that table is exactly the kind of content that will drift the moment `SPEC.md` gains a 40th variable.

### UAT Scenarios (BDD)

```gherkin
Scenario: DESIGN wave finds canonical architecture context without re-deriving it from source
  Given docs/SPEC.md documents the current OrgOps implementation
  And no docs/product/architecture/brief.md exists yet
  When solution-architect formalizes docs/product/architecture/brief.md for this feature
  Then brief.md documents the stack, monorepo layout, and core data model
  And brief.md links to docs/SPEC.md for implementation-level detail instead of copying it

Scenario: Brief stays a thin index, not a duplicate of SPEC.md
  Given docs/SPEC.md documents 39 environment variables and the full HTTP API surface
  When brief.md is authored
  Then brief.md summarizes architecture decisions and links to docs/SPEC.md for the exhaustive list
  And updating an environment variable in SPEC.md does not require a brief.md edit

Scenario: Existing WRAPPED agent mode is captured as a documented capability
  Given docs/SPEC.md describes CLASSIC, RLM_REPL, and WRAPPED agent modes
  When brief.md's component architecture section is written
  Then all three modes are listed with their responsibility boundaries
  And the WRAPPED mode's external-runtime delegation is explicitly called out as a deliberate architectural boundary

Scenario: Event contract is documented once, not re-derived per feature
  Given docs/SPEC.md's Event Contract section lists required, contextual, scheduling, and dedupe envelope fields
  When brief.md's system context is authored
  Then the event envelope shape (type, payload, source, channelId, parentEventId, deliverAt, idempotencyKey) is documented in brief.md
  And any future feature touching events references brief.md instead of re-reading SPEC.md's Event Contract section from scratch

Scenario: A reviewer catches duplication drift before it ships
  Given a draft of brief.md contains a verbatim-copied block longer than 3 lines from docs/SPEC.md
  When the story is reviewed against the Definition of Ready
  Then the duplicated block is rewritten as a summary with a link
  And the final brief.md contains no verbatim block over 3 lines copied from SPEC.md
```

### Acceptance Criteria

- [ ] `docs/product/architecture/brief.md` exists with `## System Context`, `## Component Architecture`, and `## Core Data Model` sections
- [ ] Every fact in those sections is traceable to a specific `docs/SPEC.md` section (no invented architecture)
- [ ] No block longer than 3 lines is copied verbatim from `docs/SPEC.md` into `brief.md`; exhaustive detail (env vars, full API list) stays link-only
- [ ] The `WRAPPED` agent mode's role as a deliberate delegation boundary (not just "a third mode") is explicit in `brief.md`
- [ ] `docs/product/architecture/brief.md` uses section headings solution-architect's own workflow expects (`## Application Architecture` reserved for that architect's later additions, not overwritten by this story)

### Outcome KPIs

- **Who**: solution-architect (DESIGN wave agent), on behalf of whoever runs the next real OrgOps feature
- **Does what**: reads `docs/product/architecture/brief.md` and extends it instead of re-deriving architecture from `docs/SPEC.md` and source code cold
- **By how much**: 100% of DESIGN wave runs after this feature ships pass the reading-enforcement gate with zero missing-file markers on architecture files (vs. 0% today — the file does not exist)
- **Measured by**: DESIGN wave's own reading-enforcement checklist output, captured in that feature's `wave-decisions.md`
- **Baseline**: 0 — `docs/product/architecture/brief.md` does not exist prior to this story

### Technical Notes (Optional)

- This story's deliverable (`brief.md` itself) is authored by solution-architect during the DESIGN wave that follows this DISCUSS wave — Luna (product-owner) does not write architecture documents; this requirement defines what "done" looks like for that handoff.
- Depends on `docs/SPEC.md` remaining accurate; if `SPEC.md` itself is stale, `brief.md` will inherit that staleness (out of scope for this story — `SPEC.md` accuracy is an existing-document quality concern, not a new one introduced here).

---

## US-02: Capture Undocumented Architectural Decisions as ADRs

### Problem

`docs/SPEC.md` describes *what* OrgOps currently does (e.g. "WRAPPED agents skip OrgOps memory summaries...") but rarely records *why* — the tradeoffs that were weighed and rejected. When Marcus Webb (a future contributor) wants to add a fifth agent mode or swap SQLite for Postgres, there is no written record of why the current choices were made, so he either re-litigates settled decisions from scratch or reintroduces something the team already rejected for a documented reason nobody wrote down.

### Who

- Future OrgOps contributors (e.g. Marcus Webb) | making a change adjacent to an existing architectural decision | need to know *why* the current approach was chosen before proposing an alternative
- solution-architect and other DESIGN-wave architects | must not silently contradict a decision already made | need ADRs to check against before recommending something incompatible

### Job Traceability

JTBD skipped (per confirmed feature-level decision — see System Constraints above).

### Solution

Walk `docs/SPEC.md` for decision-shaped statements ("X handles Y this way because Z", or implicit tradeoffs visible only by contrast with alternatives) and write each as an ADR in `docs/product/architecture/adr-*.md` with Context/Decision/Consequences sections. Any decision-shaped statement found but not resolved into an ADR gets an explicit recorded deferral instead of silent omission.

### Domain Examples

1. **Happy path** — The WRAPPED agent mode's delegation-to-external-runtime design (SPEC.md lines 54-134) becomes `adr-001-wrapped-agent-mode.md`, documenting that native OrgOps prompt composition was deliberately bypassed to avoid duplicating external runtimes' (OpenClaw, Codex-based) own session/memory/tool machinery.
2. **Edge case** — The at-least-once event delivery model with idempotency keys and dead-lettering (SPEC.md "Delivery and Failure Semantics" section) becomes `adr-002-at-least-once-event-delivery.md`, documenting why exactly-once was rejected (distributed coordination cost) in favor of idempotency-key-based dedup at the consumer.
3. **Boundary/error case** — During the walk-through, Priya finds a decision-shaped statement she can't fully reconstruct the rationale for ("in-process event bus" vs. an external broker like Redis/Kafka). Rather than inventing a plausible-sounding justification, she records `adr-003-in-process-event-bus.md` with the Decision documented but the Context section flagged `[NEEDS CONFIRMATION: original rationale not found in SPEC.md or commit history — deferred to the team]`, and logs it as a red-card question in `wave-decisions.md`.

### UAT Scenarios (BDD)

```gherkin
Scenario: Undocumented mode-of-execution decision becomes a discoverable ADR
  Given docs/SPEC.md describes CLASSIC, RLM_REPL, and WRAPPED agent modes without explaining why WRAPPED exists
  When the architectural decision behind WRAPPED mode is captured
  Then docs/product/architecture/adr-001-wrapped-agent-mode.md documents the context, decision, and consequences
  And a future contributor adding a fourth agent mode can read the ADR instead of asking in chat

Scenario: Delivery semantics decision is documented with its rejected alternative
  Given docs/SPEC.md documents at-least-once delivery with idempotency-key dedup
  When the ADR for this decision is written
  Then adr-002-at-least-once-event-delivery.md names exactly-once delivery as the rejected alternative
  And the consequence (consumers must be idempotent) is stated explicitly

Scenario: A decision whose original rationale cannot be reconstructed is flagged, not fabricated
  Given the in-process event bus design has no documented rationale in SPEC.md or commit history
  When the ADR capture step reaches this decision
  Then adr-003-in-process-event-bus.md records the decision as-is
  And the Context section is marked as needing confirmation instead of inventing a plausible-sounding justification
  And a red-card question is logged in wave-decisions.md for the team to resolve

Scenario: SQLite plus Drizzle as the embedded datastore choice is captured
  Given docs/SPEC.md states the DB stack as "SQLite + Drizzle ORM" without contrasting alternatives
  When the datastore ADR is written
  Then adr-004-sqlite-drizzle.md documents the single-host-simplicity tradeoff against a client-server database
  And the consequence (no built-in multi-writer concurrency) is stated as a known constraint, not hidden

Scenario: Every decision-shaped statement in SPEC.md is accounted for
  Given the full text of docs/SPEC.md has been walked for decision-shaped language
  When the ADR set is finalized
  Then every decision-shaped statement found has either a corresponding ADR file or a recorded deferral note
  And none are silently left unaddressed
```

### Acceptance Criteria

- [ ] At least 4 ADRs exist in `docs/product/architecture/adr-*.md`, each with `## Context`, `## Decision`, `## Consequences` sections
- [ ] Each ADR references the specific `docs/SPEC.md` section or line range it formalizes
- [ ] At least one ADR names a rejected alternative explicitly (not just "we chose X")
- [ ] Any decision-shaped statement found during the walk-through that could not be resolved into a confident ADR has a recorded deferral, not silence
- [ ] ADR filenames follow the `adr-{NNN}-{kebab-case-title}.md` convention consumed by `solution-architect-reviewer`

### Outcome KPIs

- **Who**: OrgOps contributors adding a genuinely new architectural decision after this feature ships
- **Does what**: write an ADR in `docs/product/architecture/` instead of leaving the decision undocumented in code comments or chat
- **By how much**: 100% ADR coverage of decision-shaped statements found during this feature's inventory (4 identified, 4 documented), and the convention is available for 100% of decisions made going forward
- **Measured by**: count of `adr-*.md` files against the count of decision-shaped statements identified during DESIGN wave review
- **Baseline**: 0 ADRs exist prior to this story, despite at least 4 identifiable architectural decisions already made and shipped

### Technical Notes (Optional)

- ADR authorship happens during the DESIGN wave (solution-architect and/or the relevant specialist architect); this story defines the requirement, not the execution.
- `adr-003-in-process-event-bus.md`'s flagged Context gap is an explicit, tracked open question for the team — it must not block DoR for this story (the deferral itself satisfies "no decision-shaped statement silently omitted"), but it does block the ADR from being cited as authoritative rationale until resolved.

---

## US-03: Define Wave-Routing Rules for Future OrgOps Features

### Problem

Without a written rule, every future OrgOps feature will re-litigate the same question from scratch: "do we need to run DISCOVER first?" OrgOps is a working, in-production system with validated product-market fit (5 documented use cases in `docs/use-cases.md`, real users already depending on it) — re-running DISCOVER for every feature wastes effort re-proving something already true. But skipping DISCOVER blindly for a *genuinely* new problem space (e.g. a brand-new integration surface nobody has validated demand for) would be a real mistake, not just inefficiency.

### Who

- OrgOps contributors starting the next feature | need a fast, confident answer to "which wave do I start at?" | currently have no written guidance
- product-owner (nWave agent, this and future DISCUSS waves) | needs the migration/routing rule available at the point where the decision is made

### Job Traceability

JTBD skipped (per confirmed feature-level decision — see System Constraints above).

### Solution

Record an explicit routing rule in this feature's `wave-decisions.md`: future OrgOps features default to skipping DISCOVER (product-market fit already established) and start at DISCUSS (if requirements need discovery/journey work) or directly at DESIGN (if requirements are already clear) — with an explicit, written exception criterion for when a feature IS genuinely new enough to warrant DISCOVER.

### Domain Examples

1. **Happy path** — Priya starts "add a `daemon` wrapper harness kind." She checks `wave-decisions.md`, sees the DISCOVER-skip rule and its rationale, and starts directly at DESIGN since requirements are already clear from an internal design discussion.
2. **Edge case** — A contributor proposes "let external SaaS customers self-provision OrgOps agents via a public signup flow" — a genuinely new user segment and problem space, not an extension of the existing system. The routing rule's exception criterion ("new user segment or unvalidated problem space") correctly routes this feature to DISCOVER, because product-market fit for *that* segment is not yet established.
3. **Boundary/error case** — A contributor is unsure whether "add priority queues to event delivery" counts as routine extension or needs DISCOVER. The rule's exception criterion gives an explicit test ("does this serve the same validated use cases in `docs/use-cases.md`, or a new one?") rather than leaving it to individual judgment with no documented tiebreaker.

### UAT Scenarios (BDD)

```gherkin
Scenario: Future OrgOps features skip an unnecessary DISCOVER pass
  Given OrgOps is a working, shipped system with 5 documented use cases in docs/use-cases.md
  And this feature has recorded the DISCOVER-skip rule in wave-decisions.md
  When a contributor starts the next real OrgOps feature
  Then they consult wave-decisions.md and start at DISCUSS or DESIGN, not DISCOVER
  And the rationale (product-market fit already established) is visible to them without re-deriving it

Scenario: A genuinely new problem space still routes to DISCOVER
  Given a proposed feature targets a new user segment not covered by any of the 5 documented use cases
  When a contributor checks the routing rule's exception criterion
  Then the feature is routed to DISCOVER rather than skipped by default
  And the exception criterion (new user segment or unvalidated problem space) is the explicit test applied

Scenario: The routing decision has a written tiebreaker, not ad hoc judgment
  Given a contributor is unsure whether a feature is a routine extension or a new problem space
  When they apply the routing rule's documented test ("does this serve an existing validated use case?")
  Then they reach a routing decision without needing to ask another team member to adjudicate

Scenario: The routing rule is discoverable at the point of decision
  Given a contributor runs /nw-discuss or /nw-diverge for a new OrgOps feature
  When the wave's migration/consultation step checks for prior wave decisions
  Then wave-decisions.md's DISCOVER-skip rule is found and applied
  And the contributor does not need to search chat history or ask a teammate to learn the rule exists
```

### Acceptance Criteria

- [ ] `docs/feature/nwave-integration/discuss/wave-decisions.md` contains a `[D4]` (or equivalent) decision entry stating the default DISCOVER-skip rule with rationale
- [ ] The entry includes an explicit exception criterion for when DISCOVER IS still required
- [ ] The rule is phrased so a future `nw-discuss`/`nw-diverge`/`nw-design` invocation's "Prior Wave Consultation" step would actually surface it (i.e. it lives in a file those workflows already read, not a new undiscoverable location)
- [ ] At least one worked example of each outcome (skip DISCOVER; still need DISCOVER) is included so the rule isn't purely abstract

### Outcome KPIs

- **Who**: OrgOps contributors starting a new feature after this feature ships
- **Does what**: correctly route to DISCUSS or DESIGN instead of running a redundant DISCOVER pass, or correctly route to DISCOVER when the exception criterion applies
- **By how much**: 100% of subsequent features cite the `wave-decisions.md` routing rule in their own `wave-decisions.md` rather than re-litigating wave entry point from an empty conversation
- **Measured by**: presence of the routing-rule citation in each subsequent feature's own `wave-decisions.md`
- **Baseline**: 0 features have used this rule — it does not exist yet

### Technical Notes (Optional)

- This story is pure documentation of a team decision; it has no dependency on US-01/US-02 content existing, so it can be executed in parallel with them.
- The exception criterion intentionally stays qualitative ("new user segment or unvalidated problem space") rather than a rigid checklist, since forcing a false-precision rule risks either over-triggering DISCOVER for routine work or under-triggering it for something that genuinely needs validation.

---

## US-04: Validate SSOT Readiness with a Real Next-Feature Dry Run

### Problem

A `docs/product/architecture/brief.md` and ADR set that merely *exist* are not the same as a `brief.md` and ADR set that are actually *usable* by a real DESIGN wave. Structural mistakes (a missing heading solution-architect expects, an ADR filename that doesn't match the convention `solution-architect-reviewer` checks for) won't surface until someone tries to use the SSOT for real — and by then, the bootstrap will have been declared "done" prematurely.

### Who

- Priya Raman | wants confidence that the bootstrap actually works before calling it complete, not just that files exist
- solution-architect | the actual consumer whose reading-enforcement gate is the real test of readiness

### Job Traceability

JTBD skipped (per confirmed feature-level decision — see System Constraints above).

### Solution

Run `/nw-design` against the next real OrgOps feature-id (not a synthetic test feature) once US-01, US-02, and US-03 are complete, and confirm the DESIGN wave's reading-enforcement gate passes with zero missing-file markers, and that the routing rule from US-03 is actually cited in that feature's own `wave-decisions.md`.

### Domain Examples

1. **Happy path** — Priya runs `/nw-design` for "add a `daemon` wrapper harness kind" (a real, already-planned feature). The reading-enforcement checklist shows `docs/product/architecture/brief.md` and all four ADRs read successfully, with zero missing-file markers.
2. **Edge case** — The dry run reveals `brief.md` is missing the `## Application Architecture` heading solution-architect's own template expects for its section — a structural gap invisible from just reading the file, only surfaced by trying to use it. It's fixed as part of closing this story, not deferred.
3. **Boundary/error case** — The dry-run feature's own `wave-decisions.md` doesn't end up citing the US-03 routing rule (the contributor running it wasn't told to check `wave-decisions.md` first). This is treated as a failure of this story's acceptance criteria, not a footnote — the rule existing on paper but not being consulted in practice means the routing story (US-03) hasn't actually achieved its outcome yet.

### UAT Scenarios (BDD)

```gherkin
Scenario: Next feature's DESIGN wave passes its reading-enforcement gate on the first try
  Given docs/product/architecture/brief.md and adr-*.md were created by US-01 and US-02
  When solution-architect runs the DESIGN wave for the next real OrgOps feature
  Then the reading-enforcement checklist shows all files as read with zero missing-file markers
  And solution-architect extends brief.md under a new section instead of recreating system context

Scenario: A structural gap in brief.md is caught by the dry run, not left for later discovery
  Given brief.md is missing a heading a downstream architect's workflow expects
  When the dry run's reading-enforcement gate runs against the real next feature
  Then the gap is identified as a concrete missing-heading finding
  And the gap is fixed before this story is considered done

Scenario: The DISCOVER-skip routing rule is actually consulted, not just theoretically available
  Given the next real feature's contributor starts their own DISCUSS or DESIGN wave
  When they run the Prior Wave Consultation step
  Then their own wave-decisions.md cites the DISCOVER-skip rule from this feature
  And they do not re-litigate whether DISCOVER is needed from scratch

Scenario: The dry run uses a real feature, not a synthetic placeholder
  Given the team has at least one concretely planned next OrgOps feature
  When the SSOT readiness validation is performed
  Then the dry run is executed against that real feature-id
  And a synthetic or throwaway feature-id is not used as a substitute
```

### Acceptance Criteria

- [ ] `/nw-design` is run against a real, already-planned next OrgOps feature-id (not a synthetic placeholder)
- [ ] The DESIGN wave's reading-enforcement checklist shows 0 missing-file markers for `docs/product/architecture/brief.md` and all `adr-*.md` files
- [ ] Any structural gap found during the dry run (missing heading, wrong ADR filename convention, etc.) is fixed as part of closing this story
- [ ] The dry-run feature's own `wave-decisions.md` explicitly cites the US-03 routing rule
- [ ] Findings from the dry run (pass/fail per file, any fixes applied) are recorded for traceability

### Outcome KPIs

- **Who**: solution-architect, on a real subsequent OrgOps feature
- **Does what**: successfully reads and extends the SSOT on the first attempt, with the routing rule cited
- **By how much**: 100% pass rate on the reading-enforcement gate for this specific dry-run feature (the concrete, measurable proof point for KPI-1's broader claim in US-01)
- **Measured by**: direct observation of the dry-run feature's DESIGN wave output and its own `wave-decisions.md`
- **Baseline**: N/A — this is the first-ever test of the SSOT, there is no prior dry run to compare against

### Technical Notes (Optional)

- Hard dependency: US-01, US-02, and US-03 must be complete before this story can execute meaningfully — a dry run against an incomplete SSOT would produce a false-negative signal, not a real readiness assessment.
- The specific "next real feature-id" is intentionally left unnamed here since it is chosen at execution time based on the team's actual roadmap, not fixed during DISCUSS.

---

## US-05: Preserve Use-Case Narratives as SSOT-Referenced Capability Documentation

### Problem

`docs/use-cases.md` documents OrgOps's 5 real use cases (same-agent same-host execution, autonomous host bootstrap, collaboration-system augmentation, human control/auditability, low-friction team operation) — the *why* behind the architecture, distinct from `docs/SPEC.md`'s *how*. If `brief.md`'s formalization (US-01) focuses purely on `SPEC.md`'s technical content, these use-case narratives risk becoming an orphaned, un-cross-referenced document that nobody thinks to consult during DESIGN — losing the product-level "why does this component exist" framing that `SPEC.md` alone doesn't carry.

### Who

- solution-architect and other DESIGN-wave architects | need to justify component boundaries against real usage, not just technical convenience | currently have no link from `brief.md` to the use cases that motivate those boundaries
- future contributors reading `brief.md` cold | want to understand what OrgOps is *for*, not just what it's *built from*

### Job Traceability

JTBD skipped (per confirmed feature-level decision — see System Constraints above).

### Solution

Trace each of the 5 use cases in `docs/use-cases.md` to a corresponding capability statement in `brief.md`'s `## System Context` section, so `brief.md` carries a "why this exists" narrative alongside its "how it's built" content, without duplicating `use-cases.md`'s prose.

### Domain Examples

1. **Happy path** — Use case 3 ("Collaboration-system augmentation" — participate beside humans in Slack/GitHub, react to events, proactive periodic work) is traced to `brief.md`'s description of the event bus + scheduled delivery (`deliverAt`) + channel model, so a reader of `brief.md` understands *why* the event contract supports scheduled delivery, not just that it does.
2. **Edge case** — Use case 5 ("Low-friction team operation" — `opscli` break-glass remediation from terminal even if UI/API are unhealthy) is traced to `brief.md`'s description of `apps/opscli` as a standalone RLM runtime independent of the API server, explaining why `opscli` doesn't depend on `apps/api` being healthy.
3. **Boundary/error case** — During tracing, Priya finds that use case 1 ("Same-agent same-host execution" via `assignedRunnerId`) has no explicit mention in her draft `brief.md`. Rather than silently leaving it out, she adds a capability statement referencing `assigned_runner_id` and the runner-selection behavior, closing the gap before declaring the story done.

### UAT Scenarios (BDD)

```gherkin
Scenario: Every documented use case is traceable to a brief.md capability statement
  Given docs/use-cases.md lists 5 numbered use cases
  When brief.md's System Context section is finalized
  Then each of the 5 use cases has a corresponding capability statement in brief.md
  And no use case is left without a brief.md reference

Scenario: Collaboration-system augmentation use case explains the event bus's scheduling support
  Given use case 3 describes proactive periodic work via scheduled events
  When brief.md documents the event contract's deliverAt field
  Then brief.md's description references the collaboration-augmentation use case as the motivating scenario

Scenario: Break-glass remediation use case explains opscli's independence from the API server
  Given use case 5 describes opscli providing break-glass remediation even if UI/API are unhealthy
  When brief.md documents apps/opscli
  Then brief.md explicitly states opscli's independence from apps/api as a deliberate resilience property, not an implementation accident

Scenario: A gap between use-cases.md and brief.md is caught, not silently dropped
  Given a draft of brief.md is compared against all 5 use cases in docs/use-cases.md
  When one use case (same-agent same-host execution) has no corresponding brief.md statement
  Then the gap is identified during review
  And a capability statement referencing assignedRunnerId is added before the story is considered done
```

### Acceptance Criteria

- [ ] All 5 use cases from `docs/use-cases.md` have a traceable capability statement in `brief.md`'s `## System Context` section
- [ ] Each traced statement references the specific mechanism that realizes the use case (e.g. `assignedRunnerId`, `deliverAt`, `apps/opscli`'s independent runtime) rather than a vague restatement
- [ ] `brief.md` does not duplicate `use-cases.md`'s prose verbatim — it references the underlying mechanism, `use-cases.md` remains the narrative source
- [ ] Any use case found to have no current architectural equivalent is flagged explicitly, not silently omitted

### Outcome KPIs

- **Who**: solution-architect and future contributors reading `brief.md`
- **Does what**: understand why a component boundary exists (which use case it serves) without needing to separately open and cross-reference `use-cases.md`
- **By how much**: 5 of 5 use cases (100%) have a traceable `brief.md` capability statement, up from 0 today (no cross-reference exists because `brief.md` doesn't exist)
- **Measured by**: manual trace-check during DoR validation — each use case number is grep-able against a `brief.md` reference
- **Baseline**: 0 — no `brief.md` exists, so no cross-referencing is currently possible

### Technical Notes (Optional)

- Depends on US-01's `brief.md` `## System Context` section existing to trace into; naturally sequenced alongside US-01 rather than strictly after it.
- Does not require changes to `docs/use-cases.md` itself — this story is purely additive linkage from `brief.md`.

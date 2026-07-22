# Wave Decisions: nWave Ticket Execution Engine

Decisions, open questions, and risks surfaced during the DISCUSS wave, for DESIGN and beyond.

## Decision 1: Invocation Mechanism — SPIKE Skipped; Headless Feasibility Accepted as a Working Assumption

**This is the most important item in this document.**

**Update (post-DISCUSS)**: the planned validation SPIKE for this assumption was explicitly
skipped per user directive ("go straight to the track split. I'm confident that the nwave
integration can run headlessly"). Headless invocation feasibility is therefore carried into
DESIGN as an **accepted working assumption, not an empirically validated fact**. If DESIGN or
DELIVER encounters friction implementing US-04, this assumption should be the first thing
revisited — treat it as unproven until a real implementation exercises it, even though no
further spike is planned.

How OrgOps' agent-runner actually triggers and communicates with an nWave wave-pipeline run
is **not decided** anywhere in this DISCUSS-wave output. nWave's wave pipeline (DISCUSS ->
DESIGN -> DISTILL -> DELIVER) currently runs as interactive Claude Code skills/subagents
driven by slash commands inside a Claude Code session. Whether and how that pipeline can be
invoked headlessly/programmatically from OrgOps' `agent-runner` is unresolved by evidence,
though assumed feasible per the above.

**What is grounded (from reading `apps/agent-runner/src/`)**:

- OrgOps has a `WRAPPED` agent mode with a pluggable "harness" model
  (`apps/agent-runner/src/wrapper-harness/`). The built-in `command` harness
  (`wrapper-harness/command.ts`) shells out to an external command and is a *plausible*
  candidate — but its `runTurn` is blocking, single-shot, and only returns
  stdout/stderr at process exit. It has **no existing support for streaming intermediate
  per-wave progress mid-run**, which conflicts directly with this feature's highest-priority
  requirement (US-05/US-07, opportunity scores #3/#4 in `jtbd-opportunity-scores.md`).
- OrgOps separately has `shell_start`/`shell_stop`/`shell_status`/`shell_tail` tools available
  to native (`CLASSIC`/`RLM_REPL`) agents, which support long-running async processes with
  tail-able streaming output via the existing `processes`/`process_output` tables and
  `process:<processId>` WebSocket topic. This is a different, non-`WRAPPED` path that might
  be a better fit for streaming, but has not been evaluated for its suitability to host a
  multi-hour, multi-wave nWave run.
- Neither path has been validated against nWave's actual runtime requirements (headless
  invocation flag/mode, ability to accept mid-run input, ability to emit structured
  wave-boundary events).

**What DISCUSS deliberately did NOT do**: prescribe a mechanism. Every story that depends on
triggering/monitoring/intervening in an nWave run (US-04, US-05, US-07, US-08, US-09) is
written against the *observable contract* only (a run starts, has a stable id, emits
wave-progress signal, can receive input, can be halted at a safe checkpoint) — never against
an assumed implementation.

**No spike was run.** DESIGN must still pick a concrete mechanism from the two candidates above
(or another it identifies) and account for these unresolved sub-questions during design rather
than assuming them away: (1) streaming mid-run wave-progress signal, (2) accepting mid-run
input, (3) realistic "safe checkpoint" granularity for halt/pause, (4) failure/timeout
handling. Only "can it invoke nWave headlessly at all" is treated as answered (yes, per user
directive) — the rest remain open design questions, not validated facts.

**Stories carrying this dependency**: US-04, US-05 (partially — depends on US-04), US-07,
US-08, US-09. All are marked "READY WITH TRACKED DEPENDENCY" in `dor-validation.md`, not
blocked — DISCUSS-wave requirements are still valid and useful input to the SPIKE itself.

## Decision 2: No Prior DISCOVER or DIVERGE Artifacts Exist — JTBD Findings Are Unvalidated

Confirmed absent before this DISCUSS run: `docs/product/journeys/*.yaml`,
`docs/product/jobs.yaml`, `docs/product/vision.md`, `docs/project-brief.md`,
`docs/stakeholders.yaml`, `docs/feature/nwave-ticket-execution-engine/discover/`, and
`docs/feature/nwave-ticket-execution-engine/diverge/`.

**Risk**: The job stories, four forces, and opportunity scores in `jtbd-job-stories.md`,
`jtbd-four-forces.md`, and `jtbd-opportunity-scores.md` are analyst-constructed hypotheses
grounded in the user's description of the target workflow and OrgOps' actual codebase — they
are **not validated against real interviews with real ticket submitters**. This is flagged
explicitly in each of those documents' provenance sections.

**Mitigation recommended**: validate with 5-8 real ticket submitters (internally at whatever
organization first pilots this, or via a DISCOVER-wave retrofit) after Release 0 ships, using
the outcome statements in `jtbd-opportunity-scores.md` as the survey instrument. Do not treat
the current priority ordering (Release 1 "Build Trust" before Release 2 "Scale & Harden") as
immutable — it should be re-validated against real usage data as soon as Release 0 produces
any.

## Decision 3: Superseded Prior Attempt Was Explicitly Not Consulted

`docs/feature/nwave-integration-archived-2026-07-21/` exists and was **not read or reused**
per explicit instruction — it was based on a materially different (and incorrect)
understanding of the goal (OrgOps' own dev team adopting nWave as their workflow, rather than
nWave embedded as a callable engine inside the OrgOps product for ticket submitters). No
content from that archive informed this DISCUSS-wave output. If a future reader encounters
that archive, it should be treated as historical record only, not a source of requirements.

## Decision 4: Scope — Split Into 4 Independent Delivery Tracks (EXECUTED, Human-Confirmed)

Per the Scope Assessment in `story-map.md`, this feature trips 2+ "oversized" signals (5-6
bounded contexts touched; walking skeleton requires 6 integration points including one
genuine unknown; multiple independently-shippable outcomes). The LeanUX skill's prescribed
resolution when oversized is "ask the user to confirm a split before continuing." At the time
this DISCUSS run originally completed, no interactive channel was available and the brief had
pre-decided a single cross-cutting feature-id — the split was therefore flagged for future
human confirmation rather than executed unilaterally.

**Update: the human product owner has since confirmed the split.** It has been executed. This
feature is split into 4 independent delivery-track feature-ids, each with its own
`docs/feature/{track-id}/discuss/` directory (`README.md`, `wave-decisions.md`,
`dor-validation.md`, `user-stories.md`):

| Track feature-id | Stories owned | Delivery position |
|---|---|---|
| `ticket-classification` | US-01, US-02, US-03 | Walking Skeleton (Release 0) — entry point, no upstream dependency |
| `nwave-invocation-engine` | US-04 | Walking Skeleton (Release 0) — critical-path track; central open risk (see Decision 1) |
| `progress-trust-ux` | US-05, US-06, US-07, US-08, US-09, US-10 | Split: US-05/US-06 in Walking Skeleton (Release 0), US-07/US-08/US-09/US-10 in Release 1 ("Build Trust") |
| `multi-source-ingestion-governance` | US-11, US-12, US-13 | Release 2 ("Scale & Harden") |

All 13 stories are accounted for exactly once across the 4 tracks — no story was dropped,
duplicated, or altered during the split; each track's `user-stories.md` copies its assigned
stories verbatim from this feature's original `user-stories.md`, acceptance criteria and all.

**This feature directory (`docs/feature/nwave-ticket-execution-engine/`) is no longer a
standalone deliverable.** It now serves as the **shared discovery source** referenced by all 4
tracks: JTBD job stories/four forces/opportunity scores, the full 6-step journey (visual +
YAML), the shared-artifacts registry, the complete story map, prioritization, and outcome
KPIs all remain here and are cited by each track's `wave-decisions.md` rather than duplicated.
Each track's own DISCUSS artifacts are a scoped extraction plus track-specific cross-track
dependency and risk documentation, not a re-derivation of this shared context.

Cross-track dependency chain (see each track's `wave-decisions.md` for full detail):
`ticket-classification` (no upstream dependency) -> `nwave-invocation-engine` (depends on a
confirmed classification contract from `ticket-classification`'s US-03, but not on that
track's actual delivery — critical path) -> `progress-trust-ux` (depends on
`nwave-invocation-engine`'s `run_id`/wave-progress-signal contract from US-04 in full) ->
`multi-source-ingestion-governance` (US-11 depends on `ticket-classification`'s US-02 being
callable from a non-native source; US-12 depends on `progress-trust-ux`'s US-06; US-13
depends on `progress-trust-ux`'s US-05/US-07).

## Decision 5: Governance/Guardrail Policy Deliberately Deferred to Release 2

`guardrail_config` (allowed repos/paths, approval requirements) does not exist anywhere in
OrgOps today and requires organizational policy input (from an engineering-lead-equivalent
role, represented here by Priya Nair) that is outside this feature's control to define
unilaterally. Release 0 and Release 1 run against an implicit, engineering-controlled trust
boundary (e.g., a fixed allowlist of test repos) rather than a configurable one. This is a
conscious, documented trade-off (see `story-map.md` Priority Rationale item 4), not a silent
gap — DESIGN should treat "who defines and enforces `guardrail_config`" as a required
question before Release 2 (US-12) is built.

## Decision 6: Notification Infrastructure Confirmed Absent — US-10 Requires New Build

US-10 depends on an out-of-band notification channel (e.g., email) reaching submitters
outside the OrgOps UI. A targeted codebase search (`notif`, `sendEmail`, `smtp`/`SMTP` across
all `.ts` files) found **zero matches** — no email/notification sending infrastructure exists
anywhere in OrgOps today. This upgrades the earlier "unconfirmed" status (per peer review
feedback) to a confirmed gap: **US-10 requires building new out-of-band notification
infrastructure from scratch**, not wiring into an existing capability. This has direct effort
implications and should be factored into DESIGN-wave estimation and sequencing for US-10 —
it is plausibly a larger, more independent piece of work than its story-map placement in
Release 1 currently implies, and DESIGN should re-assess whether it belongs in Release 1 or
should move to Release 2 once its true scope (provider selection, delivery reliability,
opt-out/preferences) is understood.

## DESIGN Wave Closure — All 4 Tracks Complete (Post-Split)

**Update, added after all four delivery tracks' DESIGN waves ran to completion.** Per Decision 4's
split, each track ran its own DESIGN-wave pass independently, in dependency order
(`ticket-classification` -> `nwave-invocation-engine` -> `progress-trust-ux` ->
`multi-source-ingestion-governance`). All four have now produced an accepted, peer-reviewed
architecture pass:

| Track feature-id | DESIGN status | Peer review outcome |
|---|---|---|
| `ticket-classification` | Complete | Conditionally approved (0 critical / 3 high / 2 medium — all remediated) |
| `nwave-invocation-engine` | Complete | Pending review status recorded in its own `design/wave-decisions.md` (see that track's document for the exact outcome) |
| `progress-trust-ux` | Complete | Conditionally approved (0 critical / 1 high — remediated) |
| `multi-source-ingestion-governance` | Complete | Conditionally approved (0 critical / 3 high / 2 medium — all remediated) |

**ADR range**: `adr-0001` through `adr-0012`, spanning all four tracks:
- `adr-0001`, `adr-0002` — `nwave-invocation-engine` (invocation mechanism, wave-boundary process
  chaining)
- `adr-0003`, `adr-0004` — `ticket-classification` (ticket/classification data model,
  classification decoupled from intake)
- `adr-0005`, `adr-0006`, `adr-0007` — `progress-trust-ux` (US-10 notification scope deferred,
  halt/pause wave-boundary checkpoint, completion-summary anchor pending the DELIVER-wave
  contract)
- `adr-0008` through `adr-0012` — `multi-source-ingestion-governance` (Trello snapshot-diff
  polling, Trello/tickets blocking-dependency resolution, `guardrail_config` minimal scope,
  request-changes/retry run-model mapping, provisional staleness threshold)

**Single consolidated architecture document**: `docs/product/architecture/brief.md` now contains
all four tracks' passes as additive top-level sections (`## Application Architecture`,
`## Ticket Classification`, `## Progress & Trust UX`, `## Multi-Source Ingestion & Governance`),
in the order each track's DESIGN wave ran. No section was rewritten by a later pass; every
cross-track correction used the `## Changed Assumptions` back-propagation pattern (new,
additive columns/enum values only) rather than silent edits. This is the one document a future
reader should consult for the complete cross-track architecture picture — each track's own
`design/wave-decisions.md` records that track's specific decisions and peer-review remediation
history, but `brief.md` is the consolidated technical reference.

**Open items carried past DESIGN, not resolved by any track (named, not hidden)**:
- The DELIVER-wave output contract gap (`branchRef`/`prUrl`/`scenariosPassed`/`changedFilePaths`)
  remains open — every completion summary ships degraded, and every Release 2 run requires
  universal governance sign-off, until a future pass (on `nwave-invocation-engine` or nWave
  itself) defines it.
- Headless nWave invocation feasibility (Decision 1) remains an accepted working assumption, not
  yet validated by a real implementation.
- `guardrail_config`'s real policy content (which paths, which repos) remains organizational
  input outside this feature's control (Decision 5) — the allowlist mechanism exists, empty.
- Real wave-duration data to replace the provisional staleness/unusually-long-wave heuristics
  (both `progress-trust-ux` and `multi-source-ingestion-governance`) does not yet exist.

## Risks Summary (Business / Technical / Project)

| Risk | Category | Probability | Impact | Mitigation |
|---|---|---|---|---|
| Invocation mechanism proves infeasible with acceptable latency/streaming fidelity | Technical | Medium | High | SPIKE explicitly skipped per user directive; accepted as a working assumption, first real implementation attempt is now the validation point (Decision 1) |
| JTBD priorities don't match real submitter behavior | Business | Medium | Medium | Validate with real users post-Release-0 (Decision 2) |
| Feature scope creeps further once DESIGN starts detailing 5-6 bounded contexts | Project | Medium | Medium | RESOLVED — split into 4 delivery tracks, human-confirmed and executed (Decision 4) |
| Guardrail policy ownership is unclear inside a real adopting org | Business | Medium | High | Named as an open question for Release 2, not assumed (Decision 5) |
| Notification infra confirmed absent — US-10 needs net-new build, may be under-sized in current Release 1 placement | Technical | High (confirmed) | Medium | Re-scope/re-estimate US-10 in DESIGN; consider moving to Release 2 if scope proves larger than a single story (Decision 6) |

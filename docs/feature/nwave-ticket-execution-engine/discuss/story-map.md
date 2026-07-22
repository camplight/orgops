# Story Map: nWave Ticket Execution Engine

## User: Maria Santos (Senior Product Manager, Fenwick Analytics) — primary; Devon Park
(Support Engineer) and Carlos Mendes (Customer Success Manager) as alternate submitters;
Priya Nair (Engineering Lead) as governance stakeholder.

## Goal: File a ticket and get working, verifiable implementation without chasing a
developer, while always being able to tell what's happening and intervene if needed.

## Backbone

| 1. Submit Ticket | 2. Classify Ticket | 3. Prepare & Confirm Intent | 4. Execute Implementation | 5. Monitor Progress | 6. Intervene / Get Notified | 7. Receive & Review Completed Work |
|---|---|---|---|---|---|---|
| Submit via OrgOps-native form | Auto-classify dev vs. not | Restate understood intent for confirmation | Trigger nWave run (mechanism TBD by SPIKE) | See live "it's working" signal | Post a mid-run note | Receive completion summary |
| Submit via Trello card (existing `trello-cli`) | Show classification rationale | Check ticket has enough detail before starting | Track run via stable `run_id` | See wave-by-wave progress (DISCUSS/DESIGN/DISTILL/DELIVER) | Pause/halt a running implementation | Approve or request changes |
|  | Human-correct a misclassification |  | Apply guardrail_config before auto-triggering | View raw output on demand | Get notified when input is needed | Recover from a failed/stuck run |

## Walking Skeleton — Judgment Call and Rationale

**Decision: YES, build a walking skeleton, but scope it narrowly and treat the Execute
Implementation activity as a swappable seam, not a finished mechanism.**

### Why a walking skeleton is the right structure here

Evidence from `apps/agent-runner/src/`:

- OrgOps already has strong, reusable primitives for most of the loop: channels + events +
  WebSocket topics (`channel:<channelId>`) give a working feedback substrate; the `processes`
  /`process_output` tables plus `process:<processId>` topic give streaming output for
  long-running work; the `trello-cli` skill already provides a working ticket-source read
  path. None of these need to be invented.
- What's missing is genuinely new domain modeling (ticket store, classification, wave-status
  tracking, guardrail config — see `shared-artifacts-registry.md`), which is exactly the kind
  of thing a thin end-to-end slice de-risks fastest: it forces the new domain concepts to be
  defined narrowly enough to actually wire together, rather than designed in the abstract.
- The single highest-value hypothesis in this feature — "can OrgOps close the loop from
  ticket to visible implementation progress at all?" — can be tested without resolving every
  activity to production quality.

### Why it must be scoped narrowly (the one blocking caveat)

- Activity 4 (Execute Implementation) depends on invoking nWave's wave pipeline, which today
  is interactive Claude Code skills/subagents driven by slash commands. Whether/how
  agent-runner can invoke this headlessly is an **unresolved technical question** (see
  `wave-decisions.md`). The existing `WRAPPED` agent `command` harness (blocking, single
  command, captures stdout/stderr only at exit — see
  `apps/agent-runner/src/wrapper-harness/command.ts`) is a plausible but unproven fit; it has
  no mechanism today for streaming intermediate per-wave progress mid-command, which directly
  conflicts with the #3/#4 highest-opportunity outcomes (glanceable progress, fast detection
  of wrong-direction runs) from `jtbd-opportunity-scores.md`.
- Rather than let this unknown block the walking skeleton entirely, or silently assume a
  mechanism, the skeleton is designed with the invocation step as an explicit **swappable
  seam**: US-04 defines the requirement ("OrgOps must be able to trigger nWave-driven
  implementation of a ticket and receive back wave-progress signal") without prescribing the
  mechanism. The SPIKE (flagged in `wave-decisions.md`) validates the mechanism before DESIGN
  commits to one. This keeps DISCUSS honest about what is known vs. unknown while still
  letting the rest of the skeleton (intake, classification, monitoring, completion) be
  designed and built in parallel.

### The walking skeleton (Release 0)

One task per activity, thinnest possible slice — every activity is represented:

1. **Submit**: OrgOps-native ticket form only (Trello ingestion deferred to Release 2 —
   `trello-cli` already exists, so this is a sequencing choice, not a capability gap).
2. **Classify**: single agent-driven binary decision (dev work / not), rationale posted to
   channel. No guardrail_config yet — no auto-approval-required distinction.
3. **Prepare & Confirm**: plain-language restatement posted; submitter confirms or corrects.
   No "not enough detail" detection yet (that's Release 1's US-08/US-10 territory).
4. **Execute**: nWave run triggered via whatever mechanism the SPIKE validates as viable.
   **This task is conditionally blocked** — the rest of the skeleton can be built and
   demoed with a stubbed/manual trigger standing in for the real mechanism until the SPIKE
   resolves it.
5. **Monitor**: raw process output stream only (leveraging existing `process_output`
   infrastructure), no curated wave-status layer yet (that's Release 1's US-07).
6. **Intervene**: not in the skeleton — deferred to Release 1 (US-08/US-09).
7. **Conclude**: completion message posted with a link to produced artifacts; submitter
   reviews manually (no approve/reject UI yet — that's Release 2's US-12).

This is deliberately thin: it proves the loop closes, using the lowest-fidelity version of
each activity, while explicitly flagging the one activity (Execute) that cannot be finalized
without the SPIKE.

## Release 1: "Build Trust" (targets opportunity scores #3, #4, #5)

- US-07 Wave-by-wave progress instead of raw output only
- US-08 Ask a clarifying question mid-run and get a response
- US-09 Pause or halt a running implementation
- US-10 Get notified when implementation needs input to continue

**Outcome KPI targeted**: reduction in "is it stuck?" support questions / increase in
submitters who report feeling confident checking progress unprompted (see
`outcome-kpis.md`).

## Release 2: "Scale & Harden" (targets opportunity scores #1, #2, #6, #7)

- US-11 Trello-sourced tickets trigger the same flow as native tickets
- US-12 Approve or request changes to completed implementation (adds guardrail_config-aware
  review)
- US-13 Failed or stuck runs surfaced with recovery options

**Outcome KPI targeted**: increase in tickets fully closed without a human developer's direct
involvement; reduction in time-to-implementation-start (see `outcome-kpis.md`).

---

## Priority Rationale

Priority order is **Walking Skeleton > Release 1 > Release 2**, per the tie-breaking rule in
`nw-user-story-mapping` (Walking Skeleton > Riskiest Assumption > Highest Value):

1. **Walking Skeleton first** because it is both the riskiest-assumption test (does the loop
   close at all, and is the invocation mechanism even viable) and the precondition for every
   other release — none of Release 1/2's stories are demonstrable without it.
2. **Release 1 before Release 2** because `jtbd-opportunity-scores.md` ranks visibility (#3,
   #4, opportunity score 17) and intervention ability (#5, score 15) strictly above breadth of
   ticket sources (#1, score 11) and governance/review refinement (#2/#7, score 14 each).
   Anxiety is the dominant force in `jtbd-four-forces.md` — a submitter who cannot see
   progress or intervene will not trust the engine regardless of how many ticket sources feed
   it. Trust must be earned before scale is worth investing in.
3. **Within Release 2**, US-11 (Trello ingestion) is lower-risk than US-12/US-13 because the
   `trello-cli` skill already exists as a working read path — it is largely a wiring task, not
   new capability, so it is sequenced first within the release to bank a quick win.
4. Governance (`guardrail_config`, US-12) is deliberately placed in Release 2, not the
   walking skeleton, because it requires human-defined policy that does not exist yet
   (Priya Nair's ruleset) — building it into the skeleton would block the skeleton on an
   organizational decision outside this feature's control. This is a conscious trade-off:
   Release 0 and Release 1 run with implicit trust boundaries (e.g., a fixed allowlist of
   test repos) rather than configurable guardrails, and this is called out as a known
   limitation, not a silent gap.

---

## Scope Assessment (Elephant Carpaccio Gate)

**Signals checked**:

| Signal | Present? | Detail |
|---|---|---|
| >10 user stories | No | 13 stories total across 3 releases (6 skeleton + 4 Release 1 + 3 Release 2) |
| >3 bounded contexts/modules touched | **Yes** | Ticket intake, classification, nWave invocation/execution, progress/feedback channel, completion & review, governance — five to six distinct concerns |
| Walking skeleton requires >5 integration points | **Yes** | Ticket source -> classifier -> nWave engine -> agent-runner -> channel/WS -> submitter's browser -> (review) — six integration points, one of which is an open technical unknown |
| Estimated effort >2 weeks | Likely, pending SPIKE and DESIGN estimates — not scored with confidence here | Not counted toward the signal total; genuinely unknown until SPIKE/DESIGN |
| Multiple independent user outcomes that could ship separately | **Yes** | Ticket ingestion, classification, execution/monitoring, and review are each independently valuable and independently demonstrable |

**2+ signals present -> this feature is OVERSIZED by the gate's own criteria.**

### Resolution: Conditional Pass, Not a Silent Pass

Per the gate, an oversized feature should be split and the split confirmed with the user
before proceeding. This run has no interactive channel to obtain that confirmation (the
brief pre-decided `feature_type: cross-cutting` and a single feature-id with all deliverables
scoped under it). Given that constraint, the resolution applied here is:

- **Do not fragment the DISCUSS-wave artifacts** into separate feature directories now — doing
  so would break the cross-cutting journey coherence the brief explicitly asked for (a single
  ticket-to-implementation emotional arc, not four disconnected features), and DISCUSS-wave
  cost of documenting the same journey four times with duplicated shared-artifact registries
  would exceed the benefit.
- **Do** manage the size the way Elephant Carpaccio actually prescribes: thin, independently
  demonstrable, end-to-end slices (the Walking Skeleton / Release 1 / Release 2 structure
  above), each shippable and valuable on its own, rather than one big-bang delivery.
- **Do** flag explicitly, for the human product owner and for DESIGN: this feature is a strong
  candidate to be split into separate *delivery tracks* (e.g., "Ticket Classification",
  "nWave Invocation Engine", "Progress & Trust UX", "Multi-Source Ingestion & Governance") at
  the DESIGN/DELIVER wave boundary, once the SPIKE resolves the invocation mechanism and
  bounded-context ownership becomes clearer. This decision is recorded in
  `wave-decisions.md` as an explicit open item requiring the human product owner's
  confirmation before DESIGN finalizes team/repo structure.

**Scope Assessment: CONDITIONAL PASS — 13 stories, 5-6 bounded contexts, effort not yet
estimated (pending SPIKE). Right-sized delivery achieved via walking-skeleton + release
slicing within one feature-id; a future split into independent delivery tracks is
recommended and flagged for human confirmation before DESIGN, not silently assumed.**

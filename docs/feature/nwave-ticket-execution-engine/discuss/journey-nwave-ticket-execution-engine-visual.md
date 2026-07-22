# Journey (Visual): nWave Ticket Execution Engine

**Persona**: Maria Santos, Senior Product Manager, Fenwick Analytics — files a ticket and
needs to trust/monitor/interact with an autonomous implementation process. (Devon Park and
Carlos Mendes appear in step annotations as alternate submitters; Priya Nair appears as the
governance stakeholder in the classification and completion steps.)

**Platform**: Web (OrgOps UI — React/Tailwind dashboard + real-time channel view over
WebSocket) plus the ticket's source system (Trello board card, or an OrgOps-native ticket
form). Not a CLI journey — the ticket submitter never touches a terminal. ASCII mockups below
represent OrgOps UI screens, not TUI output.

**Goal**: Maria files a ticket and gets working, verifiable implementation without chasing a
developer, while always being able to tell what's happening and intervene if needed.

## Emotional Arc

```
Start                Middle                              End (happy)         End (error path)
Hopeful/Wary  --->  Watchful (oscillates: reassured <-> anxious)  --->  Relieved/Confident | Supported, not blamed
```

- **Start**: Hopeful but wary — "this could save me days, but I don't fully trust it yet."
- **Middle**: Watchful — confidence should build with every visible signal (classification
  rationale, wave-by-wave progress, responsive intervention); anxiety spikes are only
  acceptable when immediately met with a system response (silence is the failure mode to
  design against).
- **End (happy path)**: Relieved and confident — "I can see exactly what changed and why."
- **End (error path)**: Supported, not blamed — a stuck/failed run is surfaced with a clear
  next step, not silence or a raw stack trace.

## Full Journey Flow

```
[Trigger: Maria has work          [Step 1: Submit]     [Step 2: Classify]      [Step 3: Trigger]
 that needs code changed]     -->  Files ticket on  --> System determines  --> nWave run fires
                                   Trello/OrgOps         "dev work" or not      for classified
                                   form                                        ticket
  Feels: motivated,                 Feels: hopeful,       Feels: attentive,     Feels: cautiously
  slightly annoyed at                but wary               "did it get it        trusting, "ok,
  current backlog wait                                      right?"                it's moving"
  Artifacts: ticket text,          Artifacts:             Artifacts:            Artifacts:
  source system card id            ticket_id,             classification_       run_id,
                                    channel_id              result, rationale     wave_status=DISCUSS

      |                                  |                       |                      |
      v                                  v                       v                      v

[Step 4: Monitor]                  [Step 5: Intervene]     [Step 6: Conclude]
Checks progress                    Posts a clarifying   -> Receives completion
whenever she wants                 constraint or            summary + links
                                    question mid-run
  Feels: watchful,                   Feels: in control,      Feels: relieved,
  reassured by real                  "it's actually            confident (happy path)
  signal (or anxious                 listening"                OR supported, not
  if silent)                                                   blamed (error path)
  Artifacts: wave_status,            Artifacts: channel      Artifacts:
  process output stream              message, run             produced_artifacts_
                                      acknowledgment            links, completion
                                                                 summary
```

## Step 1: Submit Ticket

```
+-- OrgOps UI: New Ticket (or Trello card) ------------------------------------+
| Title: [Add filter by region to Reports dashboard____________]              |
| Description:                                                                |
| [Users want to filter the existing Reports table by region. Should         ]|
| [default to the viewer's home region. No new backend endpoint needed if    ]|
| [region is already in the report payload._________________________________]|
|                                                                              |
| Source: ( ) OrgOps ticket   (*) Trello card  ( ) Jira issue                 |
|                                                                              |
|                                              [ Submit Ticket ]              |
+------------------------------------------------------------------------------+
```

- **Command/action**: Maria fills the OrgOps ticket form (or adds a Trello card on "Fenwick
  Product Backlog"; Trello ingestion reuses the existing `trello-cli` skill as the read path).
- **Shared artifacts**: `${ticket_id}` (source: ticket intake record) is created here and
  flows through every later step.
- **Emotional state**: entry = motivated but mildly frustrated by past backlog delays; exit =
  hopeful, wary ("let's see if this actually works").
- **Integration checkpoint**: A ticket-scoped OrgOps channel must exist before classification
  starts, so every later message has somewhere to land.
- **Failure modes**: Ticket has no description (nothing to classify against); ticket source
  system is unreachable (Trello API down) and the card can't be ingested.

## Step 2: Classification Result Returned

```
+-- Ticket Channel: TICKET-1043 ------------------------------------------------+
| [System] Classifying TICKET-1043...                                          |
| [System] Classified as: DEVELOPMENT WORK (confidence: high)                  |
|          Rationale: "Describes a UI change to an existing dashboard with     |
|          a testable outcome (filter behavior). No design/content-only        |
|          language detected."                                                 |
|                                                                                |
| [System] Starting nWave implementation run...                                |
+--------------------------------------------------------------------------------+
```

- **Command/action**: A classification step runs automatically after intake; no action
  required from Maria.
- **Shared artifacts**: `${classification_result}` and its rationale (source: classifier
  decision event) — consumed by the routing logic, this channel message, and Priya's audit
  view.
- **Emotional state**: entry = hopeful/wary; exit = attentive ("did it get it right?") if
  correct, or relieved-she-caught-it if she disagrees and can correct it (see Step 2 failure
  mode).
- **Integration checkpoint**: classification result must be visible *before* any
  implementation work starts, and must be human-correctable.
- **Failure modes**: Misclassification (TICKET-1044 "update pricing page copy" wrongly
  classified as dev work); ambiguous ticket (TICKET-1045 "nightly sync 40 min slower") with
  low-confidence classification requiring human confirmation.

## Step 3: Implementation Triggered

```
+-- Ticket Channel: TICKET-1043 ------------------------------------------------+
| [System] Understood: "Adds a region filter dropdown to the Reports          |
|          dashboard, defaulting to the viewer's home region."                 |
| [System] Does this match your intent?  [ Looks right ]  [ Not quite ]        |
+--------------------------------------------------------------------------------+
```

- **Command/action**: System posts a plain-language restatement of intent before committing
  engine time (Confirm job-map step) — see Note below on invocation mechanism.
- **Shared artifacts**: `${run_id}` and initial `${wave_status}` (source: nWave execution
  invocation record — **mechanism deliberately unspecified**, see Note).
- **Emotional state**: entry = attentive; exit = cautiously trusting, "ok, it's moving."
- **Integration checkpoint**: the restatement must be derived from the same ticket text the
  engine will actually use — no drift between what's shown and what's executed.
- **Failure modes**: Engine cannot be triggered (invocation mechanism unavailable/erroring);
  restatement doesn't match Maria's intent and she needs to correct before execution proceeds.

> **Note (genuine open technical question — not resolved here)**: How OrgOps' agent-runner
> actually invokes nWave's wave pipeline (currently interactive Claude Code
> skills/subagents driven by slash commands) is **not decided** in this journey. It may be a
> `WRAPPED` agent using the existing `command` harness shelling out to a headless Claude Code
> invocation, a new harness type, or something else entirely. This journey step only
> requires that *some* mechanism exists that can (a) accept a ticket as input and (b) emit
> wave-progress signal back to this channel. See `wave-decisions.md` — a SPIKE is required
> before DESIGN commits to a mechanism.

## Step 4: Progress Monitoring

```
+-- Ticket Channel: TICKET-1043 ------------------------------------------------+
| [System] DISCUSS wave complete (4 min) — requirements + acceptance criteria  |
|          drafted, 6 scenarios defined.                                       |
| [System] DESIGN wave in progress — architecture for region filter drafted    |
|          4 minutes ago.                                                      |
| [System] DISTILL wave pending.                                               |
| [System] DELIVER wave pending.                                               |
|                                                                                |
|          Last activity: 90 seconds ago            [ View raw output ]        |
+--------------------------------------------------------------------------------+
```

- **Command/action**: Maria checks the channel whenever she wants (no polling required — she
  can also just leave it and come back).
- **Shared artifacts**: `${wave_status}` (source: wave-progress events emitted during the
  run) — the single highest-opportunity artifact per `jtbd-opportunity-scores.md` (#3, #4).
- **Emotional state**: entry = cautiously trusting; exit = watchful, ideally reassured
  (silence beyond ~2-3 minutes is the anxiety trigger to design against, per Four Forces).
- **Integration checkpoint**: "Last activity" timestamp must be real (tied to the underlying
  process/event stream), never a static placeholder — a stale timestamp is worse than none.
- **Failure modes**: Run appears stalled (no wave-progress event for an extended period) with
  no way to tell if it's "thinking" or actually stuck; raw output is too noisy to be useful
  without the curated wave-status layer (this is why Release 0's walking skeleton ships raw
  output only, and Release 1 adds the curated layer above it — see `story-map.md`).

## Step 5: Mid-Run Intervention

```
+-- Ticket Channel: TICKET-1043 ------------------------------------------------+
| [Maria] One more thing — the region filter should default to the viewer's   |
|         home region, not "All Regions."                                      |
| [System] Got it. This will be picked up before the DELIVER wave starts.      |
|          Current wave: DESIGN (unaffected by this note).                     |
+--------------------------------------------------------------------------------+
```

- **Command/action**: Maria posts a message into the ticket channel at any time; system
  acknowledges receipt and states when it will be applied.
- **Shared artifacts**: intervention message becomes part of `eventHistory` for the run,
  consumed by whichever wave is active/next when it arrives.
- **Emotional state**: entry = watchful; exit = in control, "it's actually listening" (this
  is the #5 opportunity from `jtbd-opportunity-scores.md`).
- **Integration checkpoint**: acknowledgment must state *when* the note will be honored — an
  unacknowledged message is the single fastest way to destroy trust built in Step 4.
- **Failure modes**: Message arrives but is silently dropped (no ack); message arrives after
  the affected wave has already passed and needs rework instead of simple pickup; submitter
  wants to fully halt, not just add a note (see US-09).

## Step 6: Completion & Review

```
+-- Ticket Channel: TICKET-1043 ------------------------------------------------+
| [System] Implementation complete (elapsed: 2h 14m).                          |
|          Summary: Added a region filter dropdown to the Reports dashboard,   |
|          defaulting to the viewer's home region. Filters the existing        |
|          report table client-side; no new endpoint added.                    |
|          Acceptance scenarios: 6/6 passed.                                   |
|          Branch: feature/ticket-1043-region-filter                           |
|          [ View changes ]  [ Approve ]  [ Request changes ]                  |
+--------------------------------------------------------------------------------+
```

- **Command/action**: Maria reviews the summary and either approves or requests changes.
- **Shared artifacts**: `${produced_artifacts_links}` (source: DELIVER-wave output — branch/
  PR reference), completion summary text.
- **Emotional state**: entry = watchful; exit = relieved/confident (happy path) or supported-
  not-blamed if the run failed and this is a failure summary instead (see US-13).
- **Integration checkpoint**: the summary's claims (e.g., "6/6 scenarios passed") must be
  traceable to the actual acceptance scenarios defined in DISCUSS/DISTILL — no unverifiable
  claims.
- **Failure modes**: Run fails partway through and there is no completion summary at all
  (dead silence — the worst outcome); summary overstates what was actually verified.

## Emotional Coherence Check

- No jarring transitions: every step exits into the emotional entry state of the next step
  (hopeful/wary -> attentive -> cautiously trusting -> watchful -> in control -> relieved).
- The one intentional dip (Step 4's watchful state oscillating toward anxious on silence) is
  designed to be *recoverable within the same step* by the wave-status signal, not carried
  forward as unresolved tension into Step 5/6.
- Error paths (misclassification, stalled run, failed run) always land on "supported, not
  blamed" — never a dead end or raw error output. See failure_modes per step above and
  US-13 in `user-stories.md`.

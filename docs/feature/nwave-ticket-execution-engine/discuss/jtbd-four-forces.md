# JTBD Four Forces: nWave Ticket Execution Engine

Forces analysis for the ticket submitter's decision to trust (or resist) an autonomous
ticket-to-implementation loop. Per the DISCUSS brief, this feature has a genuine competing-
motivations tension: submitters want speed/autonomy but also control/trust. These forces
drive the emotional arc in the journey artifacts and the scenario set in `user-stories.md`
(each force maps to at least one UAT scenario per `nw-jtbd-bdd-integration`).

## Push (away from the current situation)

- Maria Santos filed TICKET-1043 twelve days ago; it is still sitting in "To Do" on the
  Fenwick Product Backlog because every developer is heads-down on a launch.
- To get movement, Maria has to interrupt a specific engineer on Slack and re-explain context
  she already wrote in the ticket, because nobody reads backlog tickets proactively.
- Devon Park's bug report ("Export to CSV throws 500 on Safari") sits unactioned long enough
  that a customer escalates a second time before an engineer picks it up.
- Small, well-specified tickets (like Carlos's Slack-notification request) get bumped behind
  "bigger" work indefinitely because they never look urgent enough to schedule.

## Pull (toward the ticket execution engine)

- Implementation can start within minutes of a ticket being classified as dev work, not days.
- Maria doesn't need to find and interrupt a specific person's calendar — she files the ticket
  where she already works and the system takes it from there.
- Carlos and Devon can submit tickets without knowing anything about the codebase — the
  engine handles the how, they only need to be clear about the what.
- Well-specified, bounded implementation work (the "grunt work" of the backlog) gets done
  without competing for senior engineering attention, freeing engineers for harder problems.

## Anxiety (fears about the new solution — the dominant force for this feature)

- "What if it writes code that looks right but is subtly wrong, and nobody catches it before
  it ships?" (Maria, reviewing completed work)
- "What if it goes off for six hours doing the wrong thing and I only find out at the end?"
  (Maria, mid-run)
- "What if it touches files or systems it shouldn't — production config, an unrelated
  module, a customer's data?" (Priya Nair, Engineering Lead, governance concern)
- "How do I know my one-paragraph ticket was even understood the way I meant it?" (Carlos,
  before execution starts)
- "Can I actually stop it if I see it going wrong, or am I just watching a progress bar?"
  (Devon, mid-run)
- "What happens to my ticket if the engine gets it wrong — do I have to start over, or does
  someone quietly drop it?" (Maria, failure/error path)

Anxiety is the **strongest demand-reducing force** identified for this feature — it directly
shapes the emotional arc (see `journey-nwave-ticket-execution-engine.yaml`) and is why
Release 1 (Build Trust) prioritizes intervention/notification stories over broader ticket-
source coverage (see `story-map.md` Priority Rationale).

## Habit (existing behavior that resists adoption)

- Habit of pinging a specific trusted developer directly on Slack for anything urgent, rather
  than trusting a ticket queue to surface it.
- Habit of attending standup to get a verbal status update, rather than checking a dashboard
  or channel for machine-reported progress.
- Habit of treating "someone reviewed this code" as meaning "a human engineer reviewed it" —
  autonomous-pipeline output is not yet a trusted category of "reviewed."
- Habit (Priya's, as governance owner) of only allowing code changes that went through a
  human-run PR review process; an engine that can open a PR without a human triggering it
  competes with an existing control surface.
- Habit of only starting work on tickets that were "groomed" in a backlog refinement meeting —
  jumping straight from filed-ticket to running-implementation skips a step humans currently
  trust.

## Force-to-Scenario Mapping (used in `user-stories.md`)

| Force | Story Anchor |
|---|---|
| Push | US-01 (submit ticket without chasing a developer), US-04 (implementation starts without manual triage) |
| Pull | US-04, US-06 (fast, visible completion) |
| Anxiety | US-03 (classification rationale shown), US-05/US-07 (progress visibility), US-09 (pause/halt), US-10 (notified when input needed), US-12 (review before trusting the result) |
| Habit | US-08 (mid-run clarifying question mirrors "ask a person"), US-11 (external board ticket still works — no new tool to learn) |

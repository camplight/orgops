# Track: Ticket Classification

## Scope

Owns ticket intake (OrgOps-native form) and automatic development-work classification with
submitter-correctable results — the "front door" of the nWave Ticket Execution Engine
journey.

## Stories Owned

- US-01: Submit a Development Ticket via OrgOps-Native Form
- US-02: Automatic Classification Distinguishes Development Work From Other Ticket Types
- US-03: Ticket Submitter Sees Classification Result and Can Correct It

## Delivery Sequence Position

**Walking Skeleton (Release 0)** — per the umbrella `story-map.md`, US-01, US-02, and US-03
correspond to Activities 1 ("Submit Ticket") and 2 ("Classify Ticket") of the story-map
backbone, and are the first three tasks of the walking skeleton. This track has no upstream
dependency on any other track — it is the entry point of the journey and can be built first,
in parallel with `nwave-invocation-engine` once its output contract (a confirmed
`classification_result`) is agreed.

## Source of Shared Context

This track's JTBD grounding, full journey (all 6 steps), shared-artifacts registry, complete
story map, prioritization, and outcome KPIs remain in the umbrella feature:
`docs/feature/nwave-ticket-execution-engine/discuss/`. This track's own artifacts here are a
scoped extraction, not a re-derivation.

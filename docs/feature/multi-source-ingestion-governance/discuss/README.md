# Track: Multi-Source Ingestion & Governance

## Scope

Owns bringing tickets in from external sources (Trello) through the same flow as native
tickets, plus the governance-aware review/approval checkpoint and recovery from failed or
stuck runs.

## Stories Owned

- US-11: Ticket Ingested From an External Board (Trello) Triggers the Same Flow as a Native
  Ticket
- US-12: Ticket Submitter Reviews and Approves or Requests Changes to Completed Implementation
- US-13: Failed or Stuck Implementation Runs Are Surfaced With Recovery Options

## Delivery Sequence Position

**Release 2 ("Scale & Harden")** — per the umbrella `story-map.md`, all three stories target
the lower-ranked opportunity scores #1, #2/#7, #6 and are sequenced after Release 1 ("Build
Trust") because, per the umbrella `jtbd-four-forces.md`, anxiety (addressed by
`progress-trust-ux`) is the dominant force — a submitter who cannot see progress or intervene
will not trust the engine regardless of ticket-source breadth or governance polish. Within
this track, US-11 is sequenced first (lower risk — `trello-cli` already exists as a working
read path, largely a wiring task) to bank a quick win ahead of US-12/US-13.

## Source of Shared Context

This track's JTBD grounding, full journey, shared-artifacts registry
(`produced_artifacts_links`, `guardrail_config`), complete story map, prioritization, and
outcome KPIs remain in the umbrella feature: `docs/feature/nwave-ticket-execution-engine/discuss/`.
This track's own artifacts here are a scoped extraction, not a re-derivation.

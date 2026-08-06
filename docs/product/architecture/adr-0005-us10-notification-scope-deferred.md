# ADR-0005: US-10 Out-of-Band Notification Deferred to a Later Release; In-App Indicator Ships Now

## Status

Accepted.

## Context

US-10 requires that a run which pauses waiting for submitter input notify the submitter through
at least one channel outside the OrgOps UI (e.g., email), because submitters cannot watch a
ticket channel continuously. A targeted codebase search for `notif`, `sendEmail`, `smtp`/`SMTP`
across every `.ts` file in this repository found **zero matches** — no email/notification
infrastructure exists anywhere in OrgOps today (confirmed directly during this DESIGN pass, and
previously flagged in this track's `wave-decisions.md`, inheriting the umbrella document's
Decision 6).

This means US-10, as scoped in the story map (Release 1, alongside US-07/US-08/US-09), requires
building genuinely new infrastructure from scratch: provider selection (e.g., a transactional
email service), delivery reliability handling, and submitter opt-out/preferences — not wiring
into an existing capability, which is the pattern every other component in this track and its
two sibling tracks has followed so far. This is a materially different shape of work than the
rest of Release 1, and the umbrella `story-map.md`/`prioritization.md` already name US-07/US-08/
US-09 (not US-10) as the top three opportunity-scored stories for this release.

## Decision

**Defer the out-of-band notification-delivery half of US-10 to a later release (recommended:
Release 2).** Ship, as part of this release, only the in-app indication that a run is waiting on
input — which is not new work, but a direct byproduct of US-07's Wave Status Panel rendering
whatever `nwave_runs.status`/`pause_reason` already says. A `NotificationPort` interface
(`notify({ humanId, channel, subject, body })`) is named now so a future pass has a defined seam,
but no adapter, provider selection, or delivery-reliability mechanism is designed or built in
this pass.

This is an explicit scope call surfaced for the human product owner's confirmation, not a silent
under-scoping: the recommendation is to move the real US-10 (out-of-band delivery) later, not to
claim the in-app stub satisfies US-10's AC5 ("notification reaches the submitter through at least
one channel outside the OrgOps UI") — it does not, and this ADR does not claim otherwise.

## Alternatives Considered

### 1. Build full email notification infrastructure now, in Release 1

**Rejected.** Provider selection (with OSS-first/open-standard preference where possible, e.g.
SMTP via an OSS-friendly relay, or a well-maintained transactional API), delivery-reliability
handling (retries, bounce handling), and opt-out/preference management are each non-trivial,
multi-day pieces of net-new infrastructure with no existing scaffolding to extend — a
fundamentally different effort profile than every other story in this track. Building this now
would make Release 1 disproportionately large relative to its own opportunity-scored priorities
(US-07/US-08/US-09 are explicitly ranked above US-10 in the umbrella `jtbd-opportunity-scores.md`
per this track's `wave-decisions.md`), without a corresponding increase in validated user value
for this release.

### 2. Ship an in-app-only stub and mark US-10 as satisfied

**Rejected.** This would silently under-scope a real, explicit acceptance criterion (AC5:
"notification reaches the submitter through at least one channel outside the OrgOps UI"). The
in-app indicator is genuinely useful and ships for free from US-07, but calling it "US-10 done"
would misrepresent what was built — the task's own instructions explicitly warn against this
category of silent under-scoping.

### 3. Defer the out-of-band half to a later release; ship the in-app half now as a byproduct of US-07 (chosen)

**Accepted.** Honest about what ships and what doesn't. Avoids disproportionate scope growth in
this release. Gives a future release a dedicated slot to properly evaluate a notification
provider — a decision with real trade-offs (deliverability, cost, OSS-vs-vendor) that deserves
its own ADR when it happens, rather than being rushed to fit into this release's timeline.
Consistent with this track's own risk register, which already flags US-10 as the story whose
true scope was least well understood at DISCOVERY time.

## Consequences

**Positive**

- Release 1 stays proportionate to its own validated priorities (US-07/US-08/US-09).
- No rushed, under-evaluated provider/vendor decision is made under release-timeline pressure.
- The in-app half of US-10 ships as an explicit, honest byproduct of already-planned work
  (US-07), at zero additional cost.
- `NotificationPort`'s existence as a named seam means a future Release-2 pass is not starting
  from zero — the integration point is already identified.

**Negative**

- US-10's AC5 is not fully satisfied in this release. Submitters not actively watching the UI
  will not be pulled back in when a run genuinely needs their input, until Release 2. This is a
  real, acknowledged gap, not a hidden one — the "paused-for-input run must survive 7 days
  without state loss" NFR still applies and is unaffected by this deferral (state survival does
  not depend on notification delivery).
- Also noted independent of this ADR (see brief.md's Cross-Cutting Gap): the trigger for US-10 —
  a wave signaling "I need input, pausing myself" — is not yet buildable at all, since no
  wave-completion signal richer than a binary exit code exists today. Even a Release-2
  notification adapter has nothing to trigger on until that separate gap closes.

## Enforcement

No new structural rule beyond the existing module-boundary rules — `NotificationPort` is defined
in `progress-trust-ux` alongside its sibling ports, with no adapter implementation to enforce
against yet.

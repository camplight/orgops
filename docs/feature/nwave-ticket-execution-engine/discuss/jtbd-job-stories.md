# JTBD Job Stories: nWave Ticket Execution Engine

## Scope Note

This feature embeds nWave as a callable implementation engine inside OrgOps itself. The
"user" whose job is being analyzed is **the person who files a ticket and needs development
work done** — not an OrgOps developer running nWave slash commands interactively. No prior
DISCOVER-wave customer interviews exist for this feature (confirmed absent at
`docs/feature/nwave-ticket-execution-engine/discover/`). Job stories below are grounded in:
(a) the explicit target workflow described by the user, (b) OrgOps' actual existing
capabilities (agents, events, channels, processes, the `trello-cli` skill), and (c) standard
JTBD reasoning about competing motivations. **They are analyst-constructed hypotheses, not
validated interview findings** — this gap is flagged as a risk in `wave-decisions.md` and
should be validated with real ticket submitters before/alongside DESIGN.

## Personas

- **Maria Santos** — Senior Product Manager, Fenwick Analytics (40-person B2B SaaS, Series B).
  Manages the "Fenwick Product Backlog" Trello board. Not a developer. Files 8-12 tickets/week.
  Primary persona — the ticket submitter.
- **Devon Park** — Support Engineer, Fenwick Analytics. Files bug tickets escalated from
  customers. Secondary submitter persona.
- **Carlos Mendes** — Customer Success Manager, Fenwick Analytics. Occasional, less-technical
  ticket submitter.
- **Priya Nair** — Engineering Lead, Fenwick Analytics. Does not submit tickets for this
  feature's journey, but owns the guardrails/governance the engine must respect. Secondary
  stakeholder persona surfaced in anxiety forces and one story (US-13/reject path).

## Main Job Story (Big Job)

> When I have work that needs code written or changed, I want to hand it off as a ticket and
> trust that it gets implemented correctly without me chasing a developer's calendar, so that
> I can keep moving on my own priorities and still get reliable delivery.

**Example**: Maria Santos files TICKET-1043 ("Add filter by region to Reports dashboard") on
the Fenwick Product Backlog board on a Monday morning. She wants to see it implemented and
verifiable by Wednesday without pinging anyone on Slack.

## Supporting Job Stories (8-Step Job Map, Reframed to the Ticket Submitter)

### 1. Define
> When I notice something is broken or missing in the product, I want to describe it once in
> the place I already track work (Trello board, Jira, or an OrgOps-native form), so that I
> don't have to learn a new tool just to ask for help.

Example: Devon Park adds a card "Export to CSV button throws 500 error on Safari" to the
Fenwick Product Backlog board — the same place he already logs every customer-escalated bug.

### 2. Locate
> When I file a ticket, I want the system to tell me quickly whether this is something code-level
> work will fix, so that I don't wait days only to learn it needed a different kind of help
> (e.g., a content update, a support workaround).

Example: Maria files TICKET-1044 ("Update Q3 pricing page copy"). She wants to know within
minutes that this is a content change, not development work, so she can route it to marketing
instead of waiting on an engine that will never pick it up correctly.

### 3. Prepare
> When my ticket is accepted as development work, I want the system to check whether it has
> enough detail to start safely, so that the implementation isn't guessing at what I actually
> meant.

Example: Carlos Mendes files TICKET-1046 ("Add Slack notification when invoice payment
fails") with one sentence and no acceptance criteria. He wants to be told what's missing
before hours are spent building the wrong notification.

### 4. Confirm
> When my ticket is about to be implemented, I want a moment to confirm the system understood
> my intent correctly, so that hours aren't wasted building the wrong thing.

Example: Before implementation starts on TICKET-1043, Maria sees a one-line restatement of
what will be built ("Adds a region filter dropdown to the Reports dashboard, filtering the
existing report table client-side") and can catch a misunderstanding before work begins.

### 5. Execute
> When implementation starts, I want it to proceed without needing me to babysit every step,
> so that I can go back to my own work.

Example: Once TICKET-1043 is confirmed, Maria closes the tab and goes to her 10am meeting,
trusting the engine to keep working without her staring at a screen.

### 6. Monitor
> When implementation is running, I want to check in whenever I want and see real signal (not
> silence) about what's happening, so that I never wonder if it's stuck or if anyone is "home."

Example: Maria checks back at 11:30am and sees "DESIGN wave in progress — architecture for
region filter drafted 4 minutes ago" instead of a blank screen or a spinner with no detail.

### 7. Modify
> When I see the implementation is heading in the wrong direction or I have new information, I
> want to redirect or pause it, so that it doesn't burn hours on the wrong path.

Example: Midway through TICKET-1043, Maria realizes the filter should default to the user's
home region. She posts that constraint into the ticket's channel and expects it to be picked
up before DELIVER starts, not after.

### 8. Conclude
> When implementation finishes, I want a clear summary of what changed and where, so that I can
> verify it before it goes further (e.g., merges, deploys) and close the loop with confidence.

Example: Maria receives a completion summary linking the branch/PR for TICKET-1043, the
acceptance scenarios that passed, and a plain-language description of what changed — enough
to sanity-check without reading a diff line by line.

## Traceability

Every user story in `user-stories.md` traces to one or more of the 8 supporting job stories
above (see the `Traces to Job Story` line in each story) plus the Main Job Story.

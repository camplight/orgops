# Loading and realtime: example map

Story: As an operator reading a channel, I want its history to load, new messages to appear as they happen (over the websocket, or by polling when it is down), and my reading position to be respected, so that I never miss or lose anything.

## Rules and examples

1. Opening a channel loads its timeline.
   - requests the 7 feeds (message, failed, turn, tool, context window, wrapper, process) with `limit=30&order=desc`
   - "Loading messages..." while pending; "No messages yet" when empty
   - newest-first server answer is shown oldest first
   - server error text shown when loading fails
   - selecting another channel loads its feeds and drops the previous timeline
2. "Load previous messages" is offered when the first page of messages is full (30, not 29).
   - quirk: only the message feed counts at first load (30 tool events alone do not offer it)
3. Loading older messages.
   - 5 feeds (message, turn, tool, wrapper, process; no failure/context feeds) with `before=<oldest loaded createdAt>`, the oldest of any event kind
   - older messages go above the shown ones; already shown ids are not repeated
   - short page hides the button; full page keeps it; quirk: any full feed (tools) keeps it
   - disabled "Loading previous messages..." while pending; server error shown, loaded messages kept
   - scroll position advances by the height added
4. Realtime merge and dedupe (active channel).
   - message appears; same id twice shows once; same id as a loaded event replaces its content
   - placed by time; `deliverAt` wins over `createdAt`; ties broken by id
   - ignored: no id, no channel, other channel, hidden json-render action, non-`event` frames, malformed frames
5. "New messages below" (panel layout stubbed: scrollHeight 1000, clientHeight 200).
   - at the bottom: no button, smooth scroll to bottom
   - scrolled up (distance 80 shows, 79 does not): button, no scroll
   - trace events count; hidden actions, other channels and switching channel do not
   - press: hides and scrolls; scrolling to within 80px hides, still far keeps
   - poll with a newer message: button when scrolled up, none at bottom, none when nothing new
6. Polling every 10s only while the websocket is down.
   - none before 10s; at 10s the active channel and notifications reload; repeats
   - polled message appears, loaded ones kept
   - none while connected; resumes 10s after a drop; no channel feeds with no active channel
7. Connection and reconnect backoff.
   - connects to `/ws` when signed in; not signed out, not during forced password change
   - open reloads the active channel and notifications
   - delays 400, 800, 1600, 3200, then 5000 cap; a successful open resets to 400
   - socket error closes and reconnects; sign out closes and stops reconnecting
   - missed messages appear after reconnect
8. Topic subscribe and unsubscribe.
   - nothing sent before open; on open `subscribe` per visible channel (not others' private)
   - archived channels are subscribed too
   - a new socket resubscribes all; switching channel sends nothing
   - a channel that appears (created) is subscribed live; one that disappears (deleted) is unsubscribed, others kept

## Quirks pinned
- [quirk] "Load previous messages" at first load looks only at the message feed; after loading older, any of the 5 feeds being full keeps it on.
- [quirk] An older batch is prepended newest first, so a batch of several older messages reads backwards (`chronologicalOlderEvents` reverses an already ascending list).
- Archived channels are subscribed for realtime.
- Initial layout scroll: after the first load the timeline scrolls to the bottom with `behavior: "auto"` on the next frames.

## Not now
- Unread badges on realtime events in other channels: sidebar suite.
- Trace chips and message rendering: timeline suite.
- Send flow (`wsConnected` choosing reload vs scroll): composer suite.
- popstate and channel selection details: workspace-load / dialogs.

## Assumptions
- Only the channel-scoped event routes are stubbed (one route matching `channelId=` that honours type, typePrefix, before); notifications and humans/teams routes are left unmatched (404, tolerated).
- Notification request counts are compared as deltas, not absolutes, so tests do not pin the loading sequence.
- Layout is stubbed per test by defining `scrollHeight`, `clientHeight`, `scrollTop`, `scrollTo` on the messages panel element.
- Resubscribing channels added/removed while the socket is down is not pinned separately.

## Result

Test file: `apps/user-ui/src/characterisation/loading-realtime.test.tsx` (79 tests, all green). Whole user-ui project about 3s; slowest loading-realtime test 53ms. Lint green.

Groups: Initial load (7), Offering older messages (3), Load previous messages (11), Realtime events (13), New messages below (16), Polling (8), Websocket connection (5), Reconnect backoff (7), Topics (9).

## Manual mutation probes (no Stryker run)

Each probe changed one line of `App.tsx`, ran only this file, then restored. All killed unless noted:
- poll interval 10000 to 20000: killed (8 tests)
- polling effect ignoring `wsConnected`: killed
- backoff base 400 to 500: killed; cap 5000 to 6000: killed; no reset of attempt counter on open: killed
- near-bottom `< 80` to `<= 80`: killed
- unsubscribe not sent / new topic not subscribed live: killed
- first-load `hasOlder` `=== limit` to `> 0`: killed
- older cursor `before=` off by one: killed
- `deliverAt` ignored in sort: killed
- socket open no longer reloads the channel: killed
- "New messages below" flag off for websocket events (line 1293) and for polling (line 1134): killed
- scroll handler no longer hides the button: killed
- Survived (equivalent for this suite): `rememberWsEvent` dedupe disabled (the timeline already merges by id; the dedupe only matters for unread counts, covered by the sidebar suite); showing hidden json-render actions via `setEvents` (the timeline filters them anyway).

Note: probes were briefly corrupted by another agent editing `App.tsx` at the same time; the stray `Math.min(6000` was reverted by hand and `App.tsx` ends identical to HEAD.

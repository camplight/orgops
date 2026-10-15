# Sidebar: example map

Story: As an operator, I want the sidebar to list exactly the channels I may see, grouped and named sensibly, searchable, with unread badges, so that I can find and open the conversation I need.

Viewer in all tests: alice / human-1. Owners are matched by id, participants and shares by username.

## Rules and examples

1. Visibility
   - public (or no visibility info) listed; private owned by me listed; private owned by someone else hidden
   - private shared to my username listed under Shared; share to another human, to my id, or to an agent named alice: hidden; share type read ignoring case and spaces
   - private with a team participant of one of my teams listed under Channels; other team hidden; type "team" case-insensitive; an agent whose id equals a team id does not count
   - lifecycle channels (`agent.lifecycle.` prefix, any case) hidden; `my.agent.lifecycle.x` and `agent.lifecycle` listed
   - DMs: listed only if a HUMAN participant has my username (or the DM is shared to me); an agent named alice does not count; kind and participant type read ignoring case and spaces
   - channels without participants/shares arrays do not crash
2. Grouping: Direct messages, Channels, Shared channels (in that order, API order inside); empty groups not listed; counts in headers; Shared wins over Direct and Channels; other kinds go to Channels; archived channels only under Archived; header click collapses/expands only that group; picking a channel opens it and pushes a history entry.
3. Names: channels `# name`; DM named after first non-viewer participant; "you" when alone; fallbacks to participant type and "participant"; `Direct: a, b` for group chats (only reachable via Shared or Archived).
4. Search: case-insensitive, trimmed, name or displayed DM name; archived narrowed and force-expanded; collapsed groups force-expanded while searching and collapse again after; `No channels match "x".` (hidden while loading, hidden for blank query); never reveals invisible channels.
5. Unread badges: realtime message in another visible channel counts; duplicates once; not for open channel, non-message events, json-render action messages, archived channels, messages not newer than last seen, messages without timestamp; payload null or without text still counts; opening a channel clears its badge (after its messages load); polling (10s while the socket is down) counts newer messages per channel, skips the open channel and hidden messages, replaces rather than accumulates.

Keogh probes covered: other visibility contexts (owner, share, team, DM, lifecycle), archived, search active vs not, loading vs loaded, socket down (polling) vs realtime.

## Quirks pinned (`[quirk]` in test names; log for fix tickets, nothing fixed)

1. `DIRECT_GROUP` and `AGENT_AGENT_DM` with the viewer as participant pass visibility but match no group: never listed, yet the fallback opens them as the active channel (title "Direct: ...").
2. An archived group chat is listed under Archived (archived list is not grouped).
3. Shares are keyed by username but owners by id; a share or DM participant stored under the viewer's id does not count.
4. A DM that is also shared to its participant is listed under Shared only.
5. A DM with only the viewer is named "you"; shared group chat alone is "Direct: you".
6. Participant without id is named after its type ("AGENT"); without type too, "participant".
7. Shared group chat without participants is named after its channel name.
8. Search ignores the `# ` prefix ("#" matches nothing).
9. Searching for an unlisted group chat gives an empty list without the no-match notice.
10. Clicking a group header while searching has no visible effect but is applied after the search is cleared.
11. An opened channel keeps its badge until its messages have loaded (cleared earlier only by a new message in it).
12. (Not testable) notification polling reads a stale `channels` closure, so archived/unknown channels are never skipped there. Unobservable because only non-archived channels render badges.

## Not now
- Participants panel (`participantAgentStatus`, participant labels), manage channel, unarchive: dialogs and management.
- Hidden json-render action classification in the timeline: timeline suite.
- Socket reconnect, polling mechanics, topic subscription: loading suite.
- Sign-out reset of search and badges: auth.

## Assumptions
- Only `/api/auth/me`, channels, agents, teams and a catch-all empty events route are stubbed; `/api/humans` is left 404.
- The sidebar is read as an accessibility "outline" (button texts in order), no class names or aria.
- Poll tests switch the events feed with `vi.setSystemTime` rather than mutable state.

## Result
`apps/user-ui/src/characterisation/sidebar.test.tsx`: 100 tests, green, about 1.1s for the file (whole user-ui project about 1.3s at the time, no test over 200ms). Lint passes. App.tsx untouched.

Groups: Which channels the viewer sees, Grouping, Names, Search, Unread badges.

## Mutation
Per the later change of scope, mutation testing was stopped and no gap-closing pass followed. Two configs exist (`stryker/sidebar-rules.config.json`, `stryker/sidebar-ui.config.json`, scoped to the sidebar test file, concurrency 3, timeout 30s; a default-timeout run gives false "timeout" kills). Runs before the stop, for information only: rules 79.7% -> 92.5%, UI/unread 68% -> 76.8%. Remaining survivors reviewed were dead or equivalent (lifecycle labels unreachable, non-null guards, redundant branches, unobservable archived/invisible unread counts, class names and aria).

# Workspace load: example map

Story: As an operator opening OrgOps (possibly from a shared link or a channel link), I want the workspace to open on the right channel, so that I land where I meant to be without clicking around.

## Rules and examples

1. A `?share=` token is claimed before channels are listed, and opens the claimed channel.
   - `?share=tok-1` sends POST `/api/channel-share-links/tok-1/claim` before GET `/api/channels?includeArchived=1`
   - the claimed channel (#shared-ops) opens even when `?channel=` names another channel
   - the URL ends as `?channel=<claimed id>` with no `share`
   - token is trimmed and URL-encoded (` tok/1 ` -> `tok%2F1`); a blank token sends no claim
   - Keogh: claimed channel not visible to the viewer -> first non-archived visible channel; claimed channel archived -> opens it and expands Archived
2. A failed claim does not block the workspace.
   - server text ("Share link expired") shown as an error notice
   - `share` removed from URL, existing `?channel=` link kept and opened
   - no link -> first non-archived visible channel
3. `?channel=` deep link opens that channel.
   - `?channel=ops-id` opens #ops, URL unchanged
   - unknown id / not-visible private channel -> fallback, URL rewritten to the fallback
   - linked archived channel opens and expands Archived
4. Fallback is the first non-archived visible channel.
   - archived first, private-not-mine second, public third -> third
   - only archived channels -> nothing selected ("Select a channel"), URL has no `channel`
   - no channels at all -> same
5. Archived channels auto-expand only when a link targets one.
   - default: Archived group collapsed, its channels hidden
   - fallback never expands it
   - linked archived channel (by `?channel=` or claim) expands it

## Quirks expected
- Claim failure message is whatever the server body is (or `Request failed: <status>`).
- A linked archived channel wins over any non-archived channel, but a previously active channel is only kept if non-archived (not reachable on first load).

## Not now
- Visibility rules per kind, grouping, search, unread: sidebar suite.
- popstate (back/forward) handling and `refreshChannels` fallback: dialogs and management.
- Message loading for the opened channel, websocket subscriptions: loading suite.

## Assumptions
- Events endpoints are stubbed with one empty-list route so message loading does not raise errors that mask the claim error.
- Viewer is alice / human-1; `/api/humans` and `/api/teams/me` left unmatched (the app tolerates 404).

## Result

Test file: `apps/user-ui/src/characterisation/workspace-load.test.tsx` (39 tests, all green). Whole user-ui project about 0.9s, slowest workspace-load test 35ms.

Test groups: Claiming a share link (9), Claiming a share link fails (4), Channel deep link (5), Fallback channel (5), Archived channels (4), Opening the workspace (7: loading notice, load failure message, no load while password change is required, history entry replaced not added, team-shared private channel visible or not), Archived group (4: hidden when empty, count and plus sign, toggle, pick an archived channel), Messages already present at load are not unread (1).

Quirks pinned: none new beyond the observations above. A claim failure shows the raw server body as the error and keeps the workspace usable. (Invisible-claimed channel falls back silently, no message.)

## Mutation (stryker/workspace-load.config.json; App.tsx 501-528, 895-899, 922-989, 1329-1331, 2190-2217)

Score 46.6% (68/146) before gap-filling, 61.6% (90/146) after one round. 0 real gaps remain; the other 56 survivors:

- Later suite
  - sidebar: `replace` default and `pushState` branch of updateChannelDeepLink (510, 517/518, 898), mobile sidebar close (897), search force-expanding Archived (2195 `||`), unread counts
  - dialogs and management: `setAgents`/`setHumans`/`setTeams` (956-958, 952-953 fallbacks), visible-agent computation and pruning of selected conversation agents (964-975), and the retention of the active channel in the fallback (982, only reachable via refreshChannels, which has the same logic at line 1668)
- Dead or equivalent
  - `if (!authenticated) return` in loadShell (923): the effect already guards
  - `setError(null)` (924): error is already null on first load
  - non-Error fallbacks "Unable to claim shared channel link" (945) and "Unable to load OrgOps" (989)
  - `if (channelId)` in consumeShareToken (524): selectChannel rewrites the same URL right after
  - `history` title argument (518, 527)
  - line 982 on first load: activeChannelId is always null because sign-out resets it
- Markup: `aria-expanded` (2195), `active` class name (2208)

## Open items
None.

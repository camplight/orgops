# Dialogs and management: example map

Story: As an operator, I want to start conversations, manage a channel's settings, members and sharing, and see who is in a channel, so that I can organise work with people and agents without leaving the workspace.

Viewer in all tests: alice / human-1. Only the routes a behaviour needs are stubbed (auth, channels with an "after" answer for the refresh that follows every change, agents, humans, an empty events feed); everything else is 404.

## Rules and examples

1. Conversation dialog open/close
   - New conversation button, Cmd+K, Ctrl+K, capital K open it; K alone, Cmd+J, and the sign-in screen do not
   - Cmd+K is default-prevented
   - Escape, Close button, backdrop press close it; pressing inside does not
2. Choosing agents
   - hint when none chosen; suggestions with Running/Off; search is trimmed and case-insensitive; "No matching agents."; "No available agents."; at most 8 suggestions; picking moves agent to chips and clears search; Remove returns it
   - private agent of someone else hidden unless it is in a visible channel; own private agent offered
3. Start availability: no name + no agent disabled; name enabled; blank name disabled; one agent enabled; two agents no name disabled; two agents with name enabled
4. Direct message (no name, one agent): POST direct/human-agent with agentName only; description and visibility ignored; whitespace name counts as blank; opens the DM (titled with the agent), closes dialog, expands collapsed Direct group; failure shows server text (or "Request failed: 500"), dialog stays open; error cleared on retry; Loading notice and Start disabled while pending
5. Channel (name given): create with trimmed name, trimmed description (omitted when blank), visibility (default PRIVATE); subscribe viewer then each agent; one agent plus a name makes a channel; opens it, closes dialog, expands collapsed Channels group, clears the form and channel search; create failure keeps dialog and form; viewer subscribe failure ignored; agent subscribe failure reported, dialog stays
6. Who can manage: server `canManage` wins (true shows, false hides even for the owner); without it, owner of private shows, others hide, public shows; no channel open: nothing
7. Save settings: initial values from the channel (missing visibility = Private); Save disabled until a change, disabled again when reverted; only the changed request is sent (PATCH visibility, POST archive/unarchive), visibility first; closes and keeps channel open; archived channel shows "Archived channel" and expands the Archived group; unarchive does not expand it; pending shows "Saving..." and locks form and Delete; failure shows server text, dialog open, retry possible; failed PATCH stops the archive call; Close/backdrop close; switching channel closes
8. Delete: confirm text `Permanently delete <label>?` (DM by display name); declined sends nothing; confirmed sends DELETE and removes the channel; failure keeps channel and shows text
9. Copy share link: POST share-link; copied text is the page address with `share` token and `channel` from the answer; "Link copied" for 2000ms then "Copy share link"; clipboard refusal or failed link request shows the address-bar advice
10. Participants panel (side): name, type (Human, Agent, raw type, "Participant"), 2-letter avatar; agent dot "Agent running"/"Agent off" (unknown agent = off, type read ignoring case/spaces, none for humans/teams); empty messages; shared viewers with type labels, "SV" avatar; visible to non-managers
11. Manage participants dialog: opens on top of Manage channel; list; "No participants yet."; Add disabled for blank; adds AGENT by default, HUMAN when switched, trimmed; list refreshes and field clears; datalist suggestions (visible agents, humans); Adding... pending and locked; failure keeps typed value; Remove sends stored type/id; Removing... only on that row; failure shows text; Close leaves Manage channel open; switching channel closes both
12. Shared viewers: same shape (HUMAN default, AGENT switch, trimmed, Sharing..., Remove via unshare with stored type, labels, empty text)
13. Browser history (deferred from loading-realtime): popstate opens the channel in the address; unknown, hidden or missing id opens nothing; archived channel expands Archived

Keogh probes covered: other contexts (DM vs channel, public vs private, owner vs not, archived vs live, clipboard allowed vs refused, running vs off vs unknown agent) and other outcomes (request sent, what is shown, what is cleared, which group opens).

## Quirks pinned (`[quirk]`; nothing fixed)

1. Escape closes only the conversation dialog; Manage channel and Manage participants ignore it.
2. An abandoned conversation draft (name etc.) is still there when the dialog is reopened (state is only cleared on success).
3. An unsaved visibility/archive change survives closing and reopening Manage channel (draft only resets when the channel's saved values change).
4. After deleting the open channel no channel is selected ("Select a channel") even when others remain.
5. Copying twice within two seconds: the first timer still ends the "Link copied" state early (second copy does not extend it).
6. (Not tagged) a DM request with description/visibility filled in silently drops them.

## Dead or equivalent (not tested)
- "Choose one agent for a direct message, or add a channel name." in `handleStartConversation`: Start is disabled in that state, so it cannot be reached.
- Non-`Error` throw fallbacks ("Unable to start conversation", "Unable to delete channel", etc.): `apiFetch` only throws `Error`.
- `username ? ... : Promise.resolve()` when subscribing the viewer: username is never empty once signed in.
- `if (!activeChannel) return` in save, `!activeChannelId` guards in participants/share handlers: dialogs only render with an active channel.
- Participants dialog for a channel the viewer cannot manage, `showParticipantsDialog` stacking underlay class: markup.

## Not now
- Reconnect, polling, unread badges after creating a channel: loading-realtime and sidebar suites (done).
- Share-link claim on load (`?share=`): workspace-load suite (done).

## Assumptions
- `window.confirm` is replaced per test; the clipboard via `Object.defineProperty(navigator, "clipboard")` (test files are isolated).
- Section names found by heading ("Manage channel", "Manage participants", "New conversation"), so stacked dialogs are told apart without class names.
- The datalist suggestion tests read `datalist option` values (no role or label exists); this is the one structural lookup, as in composer's file input.
- The activity panel is the second `complementary` landmark.

## Result
`apps/user-ui/src/characterisation/dialogs.test.tsx`: 141 tests, green, about 1.7s for the file, whole user-ui project about 3s, slowest test 78ms. Lint passes. No Stryker config (per scope). App.tsx untouched.

Groups: Opening and closing the conversation dialog (14), Choosing agents (11), Which conversations can be started (6), Starting a direct message (10), Starting a channel (12), Who can manage a channel (6), Saving channel settings (18), Deleting a channel (6), Copying a share link (9), Participants panel (15), Managing participants (16), Managing shared viewers (13), Browser history (5).

## Manual mutation probes (scratch copy, deleted)
34 single-line breaks, run against this file only. 33 killed on the first pass, 1 survived and was closed with a new test:
Ctrl ignored, Escape key swapped, DM threshold `>= 1`, blank description kept, visibility fixed, Direct and Channels groups not expanded, viewer subscribed as AGENT, archive/unarchive swapped, Archived group not expanded, PATCH always sent, delete keeps selection, copied reset 3s, copied flag not set, agent always running, status shown for humans, participant/share name untrimmed, Removing on all rows, unshare type fixed, 9 suggestions, private agents all visible, canManage ignored, popstate archived, search not cleared, share label, confirm inverted, backdrop propagation, Add disabled untrimmed, no refresh after add, viewer-subscribe error not swallowed, whitespace DM name.
Survivor closed: link `channel` param removed (page URL already carried it) -> test "takes the channel in the link from the API's answer" with a different channel id.

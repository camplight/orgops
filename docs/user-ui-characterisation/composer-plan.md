# Composer: example map

Story: As an operator, I want to write and send messages (with files and pasted images) in the open channel, and to see clearly when I cannot, so that I can talk to the team and agents without losing what I typed.

Viewer in all tests: alice / human-1, one public channel `# general` unless stated. Only `/api/auth/me`, channels, agents and a catch-all empty channel-events route are stubbed, plus the send and file routes each test needs.

## Rules and examples

1. Keyboard
   - Enter sends `POST /api/events` `{type: message.created, payload: {text}, source: human:alice, channelId}` and empties the box
   - Shift+Enter inserts a newline and sends nothing; a multi-line message keeps its line break
   - Enter while an IME composition is active does not send; Enter after it ended does
   - empty or whitespace-only draft: Enter sends nothing; text is trimmed before sending
   - Send button click sends; the channel opened (channel-2) is the one posted to
2. Send button: disabled for empty and whitespace drafts, enabled with text, enabled for a ready attachment without text
3. While sending: button reads "Sending..." and is disabled; text box and Attach files disabled; draft kept
4. Failure: server text shown, or "Request failed: 503" when empty; draft kept and box usable again; error cleared by the next send; after a send, messages are reloaded when the socket is down and not when it is up
5. Unavailable composer: archived (placeholder "Restore this channel to send messages"), read-only (`canPost: false`, "This channel is shared with you as read-only"), archived wins over read-only, `canPost` undefined means allowed, no channel ("Select a channel first"). Textbox, Attach files and Send all disabled.
6. Placeholder: "Message # general" while empty; with messages "(Enter to send, Shift+Enter for newline)"; DM named after the other participant
7. Offline hint: "helper is off — will reply once started." / "helper, scout are off — ..."; only stopped agents named; none when all run; agent missing from the agent list counts as off
8. Attaching files: upload (`POST /api/files` multipart `file`) then `GET /api/files/<encoded id>/meta`; "Uploading..." with Send showing "Uploading 1..."/"Uploading 2..." disabled; Enter does not send while uploading; empty pick does nothing; several files upload each; "Ready • 2.0 KB" with sizes 512 B, 1023 B, 1.0 KB, 1.5 KB, 100 KB, 1.0 MB, 150 MB, nothing for 0; file size and type fall back to the picked file, `application/octet-stream` for no type; server name wins; checksum only when non-empty; Remove drops one attachment; attachments cleared after a successful send, kept after a failed one, dropped on channel switch
9. Upload failure: server reason (or "Request failed: 500") shown on the file; warning "One or more attachments failed to upload. Remove them or retry."; meta failure fails the file; text still sendable without it; only ready files are sent; Send stays disabled with nothing else; Remove clears the warning
10. Fallback text: "Attached 1 file for reference." / "Attached 2 files for reference."; used for whitespace drafts; own text wins; Enter works too
11. Paste: image uploaded as `pasted-<ts>-<hex>.<ext>` with its type; ext from the type (jpeg); several images; text items ignored and left to the browser; image the clipboard cannot hand over ignored; pasted image sent like any attachment

Keogh probes covered: archived / read-only / no channel; sending vs idle; socket up vs down; upload ok vs failed vs meta failed; with and without text; one vs many files.

## Quirks pinned (`[quirk]`; nothing fixed)

1. The browser-local attachment id (`localId`, a random UUID) is sent to the API inside each attachment.
2. A failed upload is silently dropped when the message is sent (the warning disappears with it).
3. The draft survives a channel switch (attachments do not), so text typed for one channel can be sent to another.
4. The pasted-image extension strips symbols: `image/svg+xml` becomes `.svgxml`.

## Not now
- Rendering of sent attachments in the timeline (`parseMessageAttachments`, "Attachments" list): timeline suite, partly there.
- Participants panel and channel management, un-archiving: dialogs and management.
- Socket reconnect, polling, "New messages below" after sending: loading/realtime suite.
- Textarea auto-height (`resizeComposerTextarea`): style only, not asserted.
- "Attach files" opening the native file picker: nothing observable in happy-dom; picking is simulated by a change event on the file input (the only unavoidable DOM lookup, no label or role exists).

## Assumptions
- Enter/Shift+Enter use `user-event`. Under fake timers `user.type` hangs (RTL's async wrapper only advances jest timers), so the helper starts typing, advances the fake clock once and awaits it. IME composition uses `fireEvent.keyDown` with `isComposing`, as user-event cannot compose.
- Pasting uses `fireEvent.paste` with a fake `clipboardData.items`.
- Opening the archived channel goes through the Archived sidebar group (archived channels are never auto-selected).
- Generated pasted names are matched by pattern, not exact value (timestamp and random part).

## Result
`apps/user-ui/src/characterisation/composer.test.tsx`: 89 tests (83 `it` plus table rows), green, about 1.2s for the file; whole user-ui project 4.7s with the other suites; slowest composer test 96ms. Lint passes. No Stryker config (per scope).

Groups: Sending with the keyboard, Send button availability, While a message is being sent, When sending fails, After a message is sent, Where the composer is not available, Composer placeholder, Offline agents hint, Attaching files, When an upload fails, Attachment-only messages, Pasting images.

## Manual mutation probes
Run on a scratch copy of `apps/user-ui` (so as not to collide with another agent editing `App.tsx`; copy deleted). 23 single-line breaks; 21 killed:

enter ignores Shift, enter ignores IME, plural of "file(s)" swapped, no uploading guard in submit, textarea enabled while sending, Attach enabled while sending, textarea ignores `canPost`, extension fixed to png, paste takes non-image items, size threshold 100 -> 1000, attachments always sent (even empty), socket check inverted, text not trimmed, draft cleared on failure, server name ignored, file id not encoded, Remove removes all, offline hint always "is", error not cleared on send, attachments kept on channel switch, attachments kept after send.

Survivors, both dead or equivalent:
- Archived/read-only guard at the top of `handleSubmit`: unreachable, because a disabled textarea gets no Enter key and the Send button is disabled.
- `item.status === "ready" && item.uploaded` filter (`&& item.status === "ready"` part): `uploaded` is only ever set together with status ready, so removing the status check changes nothing.

Not probed: `[quirk]` tests and the Attach-files click (nothing observable).

# Timeline: characterisation example map

Tests: `apps/user-ui/src/characterisation/timeline.test.tsx` (330 tests, about 3s for the file, none near 100ms).
Mutation testing was skipped on the user's instruction, so there is no mutation score and no mutant-driven gap closing.

## Story

As an operator, I want the channel timeline to show messages, agent activity and failures clearly, so that I can follow what the agents are doing and act on it.

## Rules and examples (one test each, grouped as in the file)

1. **Messages and traces**: sender labels (`human:bob`, `agent:helper`, empty `human:`/`agent:`, other source, empty source); empty and loading notices; time order and `deliverAt` ordering; traces before, after and around a message stay separate; chips in time order; unknown trace types ignored.
2. **Hidden json-render actions**: hidden by `eventType`, by text prefix (case and leading spaces ignored); shown when the prefix is mid-text or the event type differs; hidden-only conversation looks empty.
3. **Plain text vs markdown**: plain text stays literal; each markdown hint (heading, bullets, numbers, quote, code, bold, italic, link, image, table); bare URLs become links; links open in a new tab; strikethrough alone is not rendered.
4. **Secret-input tags**: label, target, description, default label/submit text, attribute aliases, quotes, paired tag, invalid tags, surrounding text, disabled until typed, POST `/api/secrets` with optional scope, success and failure.
5. **Json-render blocks**: fence variants, invalid or non-object spec, root selection, every element type, flat vs nested props, title/description fallbacks, slots, choice lists, charts, no-data notices.
6. **Json-render actions**: action message request, form state, name fallbacks, disabled for read-only or archived channels, `secret.set` variants, value-field resolution, error messages, in-flight labels. SecretInput element: save, scope, valueField, errors.
7. **Turn failures**: all six classification rules with boundary words and status codes, precedence between rules, raw-text fallbacks (payload error, `lastError`, generic).
8. **Trace chips**: title and code for every trace type and payload variant.
9. **Trace detail**: toggle, switch, detail text per type, empty details.
10. **Attachments**: link, encoding, name/id fallbacks, skipped entries, type and size labels, every size boundary.
11. **Sensitive messages**: block shape, invalid payloads, reveal request, revealed plain/markdown/secret-input/json-render, hide, wrong password, empty content, errors cleared on typing, in-flight state, per-message isolation.
12. **Agent is thinking**: started/completed/failed counting, overlap, unmatched completions.
13. **Offline hint**: singular and plural, running agents, unknown agents, case-insensitive participant type, humans ignored.

## Keogh probes covered

Read-only and archived channels for json-render actions; several sensitive messages at once; wrong password vs empty reply; running vs offline vs unlisted agents.

## Quirks pinned

- `[quirk]` A scheduled message is ordered by `deliverAt`, not `createdAt`.
- `[quirk]` A message whose text is not a string appears as an empty bubble.
- `[quirk]` A sensitive message with `requiresPassword: false` still asks for a password.
- `[quirk]` An attachment size of 102399 bytes shows as "100.0 KB" (100 KB and up drops the decimal).
- Strikethrough alone (`~~x~~`) shows literally because it does not match the markdown hint regex.
- `json-render` fence name must be followed by whitespace or end of line (`json-render-draft` is not a block).

## Not now

Time display (locale and timezone dependent, not asserted). Realtime merge, loading and "New messages below". Composer pending-attachment states and the Cmd+K dialogs. Sidebar.

## Dead or unreachable (not tested)

- "Enter your password to reveal." (button is disabled without a password).
- Non-`Error` throw fallbacks in reveal, secret and action handlers.
- `traceChipCode` final `"?"` and the `traceTitle` generic fallback (every trace type is handled earlier).
- `username || "user"` in the json-render action source (an empty username means signed out).

## Assumptions

Business rules were taken from the code. Event fetches are served by one `/api/events?channelId=` route that filters by `type`/`typePrefix`, because the app needs all seven requests to succeed before it shows anything.

---
name: json-render
description: Generate interactive UI blocks in chat using fenced ```json-render specs. Supports forms, choices, actions, and secure secret capture via SecretInput or secret.set actions.
---
# json-render

Use this skill when you want to show an interactive UI in OrgOps User UI instead of plain prose.

## Output format

Return a fenced code block with info string `json-render`:

```json-render
{
  "root": "page",
  "elements": {
    "page": {
      "type": "Page",
      "children": ["section"]
    },
    "section": {
      "type": "Section",
      "title": "Example",
      "description": "Your content here"
    }
  }
}
```

Rules:

- Return only valid JSON inside the fence.
- Keep ids stable and unique inside `elements`.
- Prefer concise UI over very large trees.

## Supported element types

- `Page`
- `Section`
- `Question`
- `ChoiceList`
- `IntegrationPicker`
- `Checklist`
- `Recommendation`
- `BarGraph`
- `LineGraph`
- `ActionButton`
- `SecretInput`

## Chart engine

Charts are rendered in User UI with **Recharts**.

Important:

- Do **not** output raw React/Recharts code.
- Always output OrgOps `json-render` elements (`BarGraph` / `LineGraph`) and provide chart `data`.
- You may use Recharts docs for chart-design intuition (series shape, labels, trend vs comparison), but final output must stay valid `json-render` JSON.

## Chart data format

For `BarGraph` and `LineGraph`, pass `data` as an array. Preferred shape:

```json
[
  { "label": "Mon", "value": 14 },
  { "label": "Tue", "value": 19 }
]
```

Also accepted:

- numeric array, e.g. `[14, 19, 16]` (labels become `1`, `2`, `3`)
- point shape, e.g. `{ "x": "Mon", "y": 14 }`

Tips:

- Keep charts to ~5-12 points for readability in chat.
- Always include a short `title` and `description` for context.
- Prefer `BarGraph` for comparison and `LineGraph` for trends.
- For advanced chart behavior and option patterns, reference [Recharts documentation](https://recharts.org/en-US/guide).

## ActionButton behavior

`ActionButton` can trigger:

1. **Regular action message** (default): posts a hidden `message.created` event tagged as `ui.json-render.action`.
2. **Secret write action** (secure): if action name/type is one of:
   - `secret.set`
   - `secrets.set`
   - `orgops.secret.set`

For secret actions, the UI writes directly to `/api/secrets` and does not emit chat messages with secret values.

Recommended params for secret actions:

- `package` (or `packageId`)
- `key` (or `name`)
- `valueField` (or `valueFrom` / `secretField`) pointing to a `Question` element id
- optional: `scopeType`, `scopeId`

## SecretInput behavior (preferred for secrets)

`SecretInput` is a first-class secure element that writes directly to `/api/secrets`.

Props:

- required: `package` (or `packageId`), `key` (or `name`)
- optional: `title`, `description`, `placeholder`, `submitLabel`, `scopeType`, `scopeId`
- optional: `valueField` / `valueFrom` / `secretField` (if value comes from another question field)

## Secret safety rules

- Never ask users to paste secret values into plain chat text.
- Prefer `SecretInput` or `<orgops-secret-input ...>` over plain text instructions.
- Never echo secret values back in messages.

## Sensitive response pattern

If an agent must return sensitive output (credentials, private keys, reset URLs), do not place that value in plain markdown or inside a `json-render` block.

Use the event contract:

- send `message.created.payload.text` as safe preview only
- send actual secret in `message.created.payload.sensitive.plaintext`
- include optional `payload.sensitive.hint` for context

Example event shape:

```json
{
  "type": "message.created",
  "channelId": "<channel-id>",
  "source": "agent:<name>",
  "payload": {
    "text": "Sensitive value available. Reveal with password.",
    "sensitive": {
      "plaintext": "DATABASE_URL=...",
      "hint": "Temporary staging credential"
    }
  }
}
```

UI can still use `json-render` for follow-up actions (copy flow guidance, rotate button, next steps), but the secret itself should travel via `payload.sensitive`.


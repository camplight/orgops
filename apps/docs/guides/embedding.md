# Embedding agents in your app

External products can talk to an OrgOps agent through an OpenAI-style API. Each
integration key is bound to one agent.

## 1. Create an integration key

In the admin UI open **API keys**, create a key for the agent you want to expose and copy
the token. It is shown **only once**.

::: tip Copy prompt
The **Copy prompt** button produces a compact API description with your base URL and
agent name. Paste it into the coding agent that builds your integration.
:::

## 2. Create a conversation

Each conversation maps to its own channel, so the agent keeps separate context per
conversation.

```bash
curl -X POST https://orgops.example.com/v1/conversations \
  -H "Authorization: Bearer $ORGOPS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"idempotency_key": "user-42", "metadata": {"userId": 42}}'
```

```json
{ "id": "conv_…", "object": "conversation", "agent": "helper", "metadata": { "userId": 42 }, "created_at": 1731900000 }
```

Repeating the request with the same `idempotency_key` returns the existing conversation
(`200` instead of `201`).

## 3. Send a message

```bash
curl -X POST https://orgops.example.com/v1/chat/completions \
  -H "Authorization: Bearer $ORGOPS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "model": "helper",
        "conversation": "conv_…",
        "messages": [{ "role": "user", "content": "Summarize yesterday’s deploys" }]
      }'
```

The response is an OpenAI chat completion; read `choices[0].message.content`. The call
waits for the agent's reply (default timeout 180 s). Pass `"stream": true` to receive
Server-Sent Events ending with `data: [DONE]`.

`conversation` is required, either in the body or as the `X-OrgOps-Conversation`
header.

### Attachments

Upload a file first, then reference it either as a top-level attachment or as an image
part:

```json
{
  "model": "helper",
  "conversation": "conv_…",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "What is on this screenshot?" },
      { "type": "image_url", "image_url": { "url": "orgops://file/<fileId>" } }
    ]
  }],
  "attachments": [{ "fileId": "<fileId>" }]
}
```

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/me` | Key info: `id`, `name`, `agentName` |
| `POST /v1/conversations` | Create a conversation |
| `GET /v1/conversations/:id` | Read a conversation |
| `POST /v1/chat/completions` | Send a message and wait for the reply |

Errors are returned as `{ "error": "…" }`.

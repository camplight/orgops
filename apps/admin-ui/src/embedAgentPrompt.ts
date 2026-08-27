export function buildEmbedAgentPrompt(input: {
  baseUrl: string;
  agentName: string;
}): string {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const agentName = input.agentName.trim() || "your-agent-name";
  return `OrgOps embed API
${baseUrl}
Authorization: Bearer {ORGOPS_API_KEY}
Agent: ${agentName}

GET ${baseUrl}/v1/me
→ { id, name, agentName }

POST ${baseUrl}/v1/conversations
{ "idempotency_key"?: string, "metadata"?: object }
→ { id: "conv_…", object: "conversation", agent: "${agentName}", metadata, created_at }
201 create, 200 if same key + idempotency_key already exists

GET ${baseUrl}/v1/conversations/{id}

POST ${baseUrl}/v1/chat/completions
{ "model": "${agentName}", "conversation": "conv_…", "messages": [{ "role": "user", "content": "…" }], "stream"?: false }
conversation required (body or X-OrgOps-Conversation). No default.
→ OpenAI chat completion (choices[0].message.content). stream:true → SSE then data: [DONE]
Errors: { "error": "…" }
Timeout default 180s.
`;
}

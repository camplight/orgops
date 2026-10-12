import { z } from "zod";
import type { ExecuteContext, ToolDef } from "./types";
const selection = z
  .object({ connectionId: z.string().min(1), tool: z.string().min(1) })
  .strict();
export const composioToolDefs: ToolDef[] = [
  [
    "composio_connections",
    "List the Composio connections and exact tools your owner has granted to you. Available only in an owner-initiated private conversation.",
    z.object({}).strict(),
  ],
  [
    "composio_tool_schema",
    "Read the argument schema for one granted tool before using it.",
    selection,
  ],
  [
    "composio_execute",
    "Execute a tool already granted by your owner using their connection. Follow the human’s request; do not invent unrelated actions. Never ask for API keys or pass another user identity.",
    selection.extend({ arguments: z.record(z.unknown()) }).strict(),
  ],
];
export async function execute(
  ctx: ExecuteContext,
  tool: string,
  args: Record<string, unknown>,
) {
  const def = composioToolDefs.find((item) => item[0] === tool);
  if (!def) return { error: "Unknown Composio tool" };
  const parsed = def[2].safeParse(args);
  if (!parsed.success) return { error: "Invalid Composio tool arguments" };
  const path =
    tool === "composio_connections"
      ? "tools"
      : tool === "composio_tool_schema"
        ? "schema"
        : "execute";
  const response = await ctx.apiFetch(`/api/composio/runner/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...parsed.data,
      agentName: ctx.agent.name,
      triggerEventId: ctx.triggerEvent.id,
    }),
  });
  if (!response.ok)
    return {
      error: `Composio request denied or unavailable (${response.status})`,
    };
  return response.json();
}

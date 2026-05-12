import type { Agent } from "../types";
import type { WrapperRuntimeContext } from "./types";

export async function emitWrapperEvent(
  ctx: WrapperRuntimeContext,
  agent: Agent,
  type: string,
  payload: Record<string, unknown>,
  channelId?: string,
) {
  await ctx.api.emitEvent({
    type,
    source: "system:runner:wrapper",
    ...(channelId ? { channelId } : {}),
    payload: {
      targetAgentName: agent.name,
      ...payload,
    },
  });
}

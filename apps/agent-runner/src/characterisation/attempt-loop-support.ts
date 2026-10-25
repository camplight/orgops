import { HttpResponse } from "msw";
import type { ChannelRecord } from "../models/channel";
import type { Agent, Event } from "../types";
import { getMockAgent, getMockChannelRecord, getMockEvent, getMockExecutor } from "./factories";
import { createFakeOrgops } from "./orgops-api";
import { createFakeProvider } from "./provider";
import { server } from "./server";

type ProviderResponders = Parameters<typeof createFakeProvider>[0];

type SetUpTurnOptions = {
  responders: ProviderResponders;
  channels?: ChannelRecord[];
  agent?: Partial<Agent>;
  events?: Event[];
  skillRoots?: string[];
};

export const setUpTurn = (options: SetUpTurnOptions) => {
  const orgops = createFakeOrgops({ channels: options.channels ?? [getMockChannelRecord()] });
  const provider = createFakeProvider(options.responders);
  server.use(...orgops.handlers, provider.handler);
  const executor = getMockExecutor({
    skillRoots: (options.skillRoots ?? []).map((path) => ({ path })),
  });
  const run = () => executor(getMockAgent(options.agent), options.events ?? [getMockEvent()]);
  return { orgops, provider, run };
};

type RecordedProvider = ReturnType<typeof createFakeProvider>;

export const messageText = (provider: RecordedProvider, requestIndex: number) =>
  String(provider.requests[requestIndex]?.messages[0]?.content);

export const rawRetryTail = (provider: RecordedProvider, requestIndex: number) =>
  messageText(provider, requestIndex).slice(messageText(provider, 0).length);

export const retryTail = (provider: RecordedProvider, requestIndex: number) =>
  rawRetryTail(provider, requestIndex).trim().split("\n\n").filter(Boolean);

export const providerError = (status: number, message: string, headers: Record<string, string> = {}) =>
  () => HttpResponse.json({ error: { message } }, { status, headers });

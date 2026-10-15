import { http, HttpResponse } from "msw";
import { PROVIDER_ORIGIN } from "./provider";
import type { Event } from "../types";
import type { ChannelRecord } from "../models/channel";

export const API_ORIGIN = "http://orgops.test";

type EmittedEvent = {
  type: string;
  source: string;
  channelId?: string;
  payload: Record<string, unknown>;
  status?: string;
  parentEventId?: string;
};

type FakeOrgopsOptions = {
  channels: ChannelRecord[];
  pendingEvents?: () => Event[];
  channelHistory?: Event[];
  secretsEnv?: Record<string, string>;
};

export const DEFAULT_SECRETS_ENV = {
  OPENROUTER_API_KEY: "test-key",
  OPENROUTER_BASE_URL: PROVIDER_ORIGIN,
};

export const createFakeOrgops = (options: FakeOrgopsOptions) => {
  const { channels, pendingEvents = () => [], channelHistory = [], secretsEnv = DEFAULT_SECRETS_ENV } =
    options;
  const emitted: EmittedEvent[] = [];
  const requestLog: string[] = [];

  const handlers = [
    http.post(`${API_ORIGIN}/api/events`, async ({ request }) => {
      requestLog.push("POST /api/events");
      emitted.push((await request.json()) as EmittedEvent);
      return HttpResponse.json({ ok: true });
    }),
    http.get(`${API_ORIGIN}/api/events`, ({ request }) => {
      const url = new URL(request.url);
      requestLog.push(`GET /api/events?${url.searchParams.toString()}`);
      const status = url.searchParams.get("status");
      return HttpResponse.json(status === "PENDING" ? pendingEvents() : channelHistory);
    }),
    http.get(`${API_ORIGIN}/api/channels`, () => {
      requestLog.push("GET /api/channels");
      return HttpResponse.json(channels);
    }),
    http.get(`${API_ORIGIN}/api/secrets/env`, () => {
      requestLog.push("GET /api/secrets/env");
      return HttpResponse.json(secretsEnv);
    }),
    http.get(`${API_ORIGIN}/api/memory/*`, ({ request }) => {
      requestLog.push(`GET ${new URL(request.url).pathname}`);
      return HttpResponse.json({ record: null });
    }),
  ];

  return {
    handlers,
    emitted: () => [...emitted],
    requestLog: () => [...requestLog],
  };
};

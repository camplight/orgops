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

type MemoryRecordFixture = Record<string, unknown> | null;

export type MemoryRecords = {
  channelRecent?: MemoryRecordFixture;
  channelFull?: MemoryRecordFixture;
  crossRecent?: MemoryRecordFixture;
  crossFull?: MemoryRecordFixture;
};

const MEMORY_ENDPOINTS: Record<string, keyof MemoryRecords> = {
  "/api/memory/channel/recent": "channelRecent",
  "/api/memory/channel/full": "channelFull",
  "/api/memory/cross/recent": "crossRecent",
  "/api/memory/cross/full": "crossFull",
};

const MEMORY_HOLD_LIMIT_MS = 150;
const MEMORY_REQUEST_COUNT = 4;

type FakeOrgopsOptions = {
  channels: ChannelRecord[];
  pendingEvents?: () => Event[];
  channelHistory?: Event[] | ((query: URLSearchParams) => Event[]);
  memoryRecords?: MemoryRecords;
  holdMemoryResponses?: boolean;
  secretsEnv?: Record<string, string>;
  rejectEvent?: (event: EmittedEvent) => boolean;
};

export const DEFAULT_SECRETS_ENV = {
  OPENROUTER_API_KEY: "test-key",
  OPENROUTER_BASE_URL: PROVIDER_ORIGIN,
};

export const createFakeOrgops = (options: FakeOrgopsOptions) => {
  const {
    channels,
    pendingEvents = () => [],
    channelHistory = [],
    memoryRecords = {},
    holdMemoryResponses = false,
    secretsEnv = DEFAULT_SECRETS_ENV,
    rejectEvent,
  } = options;
  let memoryArrivals = 0;
  let arrivalsWhenFirstReleased: number | undefined;
  let releaseMemory: () => void = () => {};
  const memoryGate = new Promise<void>((resolve) => {
    releaseMemory = resolve;
  });
  const holdMemoryResponse = async () => {
    memoryArrivals += 1;
    if (memoryArrivals >= MEMORY_REQUEST_COUNT) releaseMemory();
    await Promise.race([
      memoryGate,
      new Promise<void>((resolve) => setTimeout(resolve, MEMORY_HOLD_LIMIT_MS)),
    ]);
    arrivalsWhenFirstReleased ??= memoryArrivals;
  };
  const emitted: EmittedEvent[] = [];
  const requestLog: string[] = [];
  const callLog: string[] = [];
  const memoryQueries: string[] = [];

  const handlers = [
    http.post(`${API_ORIGIN}/api/events`, async ({ request }) => {
      requestLog.push("POST /api/events");
      const event = (await request.json()) as EmittedEvent;
      callLog.push(`POST /api/events ${event.type}`);
      if (rejectEvent?.(event)) return HttpResponse.json({ error: "rejected" }, { status: 500 });
      emitted.push(event);
      return HttpResponse.json({ ok: true });
    }),
    http.get(`${API_ORIGIN}/api/events`, ({ request }) => {
      const url = new URL(request.url);
      requestLog.push(`GET /api/events?${url.searchParams.toString()}`);
      callLog.push("GET /api/events");
      const status = url.searchParams.get("status");
      if (status === "PENDING") return HttpResponse.json(pendingEvents());
      return HttpResponse.json(
        typeof channelHistory === "function" ? channelHistory(url.searchParams) : channelHistory,
      );
    }),
    http.get(`${API_ORIGIN}/api/channels`, () => {
      requestLog.push("GET /api/channels");
      callLog.push("GET /api/channels");
      return HttpResponse.json(channels);
    }),
    http.get(`${API_ORIGIN}/api/secrets/env`, () => {
      requestLog.push("GET /api/secrets/env");
      callLog.push("GET /api/secrets/env");
      return HttpResponse.json(secretsEnv);
    }),
    http.get(`${API_ORIGIN}/api/memory/*`, async ({ request }) => {
      const pathname = new URL(request.url).pathname;
      requestLog.push(`GET ${pathname}`);
      callLog.push(`GET ${pathname}`);
      memoryQueries.push(`${pathname}?${new URL(request.url).searchParams.toString()}`);
      if (holdMemoryResponses) await holdMemoryResponse();
      const key = MEMORY_ENDPOINTS[pathname];
      return HttpResponse.json({ record: (key && memoryRecords[key]) || null });
    }),
  ];

  return {
    handlers,
    emitted: () => [...emitted],
    requestLog: () => [...requestLog],
    callLog: () => [...callLog],
    memoryQueries: () => [...memoryQueries],
    memoryRequestsArrivedBeforeFirstResponse: () => arrivalsWhenFirstReleased,
  };
};

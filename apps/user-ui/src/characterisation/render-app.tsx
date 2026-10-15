import { act, render } from "@testing-library/react";
import { vi } from "vitest";
import App from "../App";
import { createFakeApi, type FakeRoute } from "./fake-api";
import { createFakeRealtime } from "./fake-realtime";
import { server } from "./server";

export type RenderAppOptions = {
  routes?: readonly FakeRoute[];
  realtimeAvailable?: boolean;
  url?: string;
};

export const settle = async (milliseconds = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
};

export const renderApp = async (options: RenderAppOptions = {}) => {
  vi.useFakeTimers();
  const api = createFakeApi(options.routes ?? []);
  const realtime = createFakeRealtime({ available: options.realtimeAvailable ?? true });
  server.use(api.handler, realtime.handler);
  window.history.replaceState(null, "", options.url ?? "/");

  const view = render(<App />);
  await settle();

  return { ...view, requests: api.requests, realtime };
};

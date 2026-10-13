import { act, render } from "@testing-library/react";
import { vi } from "vitest";
import App from "../App";
import { createFakeApi, type FakeRoute } from "./fake-api";
import { createFakeWebSocket } from "./fake-websocket";

export type RenderAppOptions = {
  routes?: readonly FakeRoute[];
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
  const websocket = createFakeWebSocket();
  vi.stubGlobal("fetch", api.fetch);
  vi.stubGlobal("WebSocket", websocket.WebSocketClass);
  window.history.replaceState(null, "", options.url ?? "/");

  const view = render(<App />);
  await settle();

  return { ...view, requests: api.requests, sockets: websocket.sockets };
};

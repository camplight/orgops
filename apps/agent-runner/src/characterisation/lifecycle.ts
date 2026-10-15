import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./server";

export const useFakeNetwork = () => {
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
};

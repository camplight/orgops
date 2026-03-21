import { describe, expect, it } from "vitest";
import App from "./App";

describe("ui", () => {
  it("exports App component", () => {
    expect(typeof App).toBe("function");
  });
});

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "./render-app";

describe("Harness smoke test", () => {
  it("shows the sign-in form when there is no session", async () => {
    await renderApp({
      routes: [{ path: "/api/auth/me", respond: { status: 401, text: "Unauthorized" } }],
    });

    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
  });
});

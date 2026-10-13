import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getMockAuthMe } from "./factories";
import type { FakeRoute } from "./fake-api";
import { renderApp, settle } from "./render-app";

const noSession: FakeRoute = {
  path: "/api/auth/me",
  respond: { status: 401, text: "Unauthorized" },
};

const sessionOf = (...sessions: ReturnType<typeof getMockAuthMe>[]): FakeRoute => ({
  path: "/api/auth/me",
  respondInOrder: sessions.map((json) => ({ json })),
});

const noSessionUntilSignIn = (me: ReturnType<typeof getMockAuthMe>): FakeRoute => ({
  path: "/api/auth/me",
  respondInOrder: [{ status: 401, text: "Unauthorized" }, { json: me }],
});

const fillIn = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const press = async (name: string) => {
  fireEvent.click(screen.getByRole("button", { name }));
  await settle();
};

const signIn = async (credentials: { username: string; password: string }) => {
  fillIn("Username", credentials.username);
  fillIn("Password", credentials.password);
  await press("Continue");
};

const chooseNewPassword = async (options: { password: string; confirmation: string }) => {
  fillIn("New password", options.password);
  fillIn("Confirm new password", options.confirmation);
  await settle();
};

const isDisabled = (name: string) =>
  (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

const isShowing = (query: () => unknown) => {
  try {
    return Boolean(query());
  } catch {
    return false;
  }
};

const showsSignInForm = () =>
  isShowing(() => screen.getByRole("heading", { name: "Welcome back" }));

const showsWorkspaceFor = (username: string) =>
  isShowing(() => screen.getByRole("button", { name: `Sign out (${username})` }));

describe("Session check on load", () => {
  it("shows the sign-in form with the username prefilled when there is no session", async () => {
    await renderApp({ routes: [noSession] });

    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("admin");
  });

  it("opens the workspace for an operator who is already signed in", async () => {
    await renderApp({ routes: [sessionOf(getMockAuthMe({ username: "alice" }))] });

    expect(showsWorkspaceFor("alice")).toBe(true);
  });

  it("asks for a new password when the session requires one", async () => {
    await renderApp({
      routes: [sessionOf(getMockAuthMe({ username: "alice", mustChangePassword: true }))],
    });

    expect(screen.getByRole("heading", { name: "Set a new password" })).toBeTruthy();
  });

  it("shows a loading screen while the session is being checked", async () => {
    await renderApp({
      routes: [{ path: "/api/auth/me", respond: () => new Promise(() => undefined) }],
    });

    expect(screen.getByText("Loading OrgOps...")).toBeTruthy();
  });

  it("treats a session without a username as signed out", async () => {
    await renderApp({ routes: [sessionOf(getMockAuthMe({ username: null }))] });

    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("admin");
  });
});

describe("Signing in", () => {
  it("keeps Continue disabled until a password is entered", async () => {
    await renderApp({ routes: [noSession] });

    expect(isDisabled("Continue")).toBe(true);
  });

  it("keeps Continue disabled when the username is blank", async () => {
    await renderApp({ routes: [noSession] });
    fillIn("Username", "   ");
    fillIn("Password", "s3cret-pass");

    expect(isDisabled("Continue")).toBe(true);
  });

  it("enables Continue once a username and a password are entered", async () => {
    await renderApp({ routes: [noSession] });
    fillIn("Username", "alice");
    fillIn("Password", "s3cret-pass");

    expect(isDisabled("Continue")).toBe(false);
  });

  it("sends the trimmed username and the password to the server", async () => {
    const { requests } = await renderApp({
      routes: [
        { method: "POST", path: "/api/auth/login", respond: { json: { ok: true } } },
        noSessionUntilSignIn(getMockAuthMe({ username: "alice" })),
      ],
    });
    await signIn({ username: " alice ", password: "s3cret-pass" });

    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/auth/login",
      body: { username: "alice", password: "s3cret-pass" },
    });
  });

  it("opens the workspace after a successful sign-in", async () => {
    await renderApp({
      routes: [
        { method: "POST", path: "/api/auth/login", respond: { json: { ok: true } } },
        noSessionUntilSignIn(getMockAuthMe({ username: "alice" })),
      ],
    });
    await signIn({ username: "alice", password: "s3cret-pass" });

    expect(showsWorkspaceFor("alice")).toBe(true);
  });

  it("shows the server's message and keeps what was typed when the credentials are wrong", async () => {
    await renderApp({
      routes: [
        noSession,
        { method: "POST", path: "/api/auth/login", respond: { status: 401, text: "Invalid credentials" } },
      ],
    });
    await signIn({ username: "alice", password: "wrong-pass" });

    expect(screen.getByText("Invalid credentials")).toBeTruthy();
    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("alice");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("wrong-pass");
  });

  it("[quirk] replaces the whole form with a loading screen while the sign-in request is pending", async () => {
    await renderApp({
      routes: [
        noSession,
        { method: "POST", path: "/api/auth/login", respond: () => new Promise(() => undefined) },
      ],
    });
    await signIn({ username: "alice", password: "s3cret-pass" });

    expect(screen.getByText("Loading OrgOps...")).toBeTruthy();
    expect(showsSignInForm()).toBe(false);
  });
});

describe("First-time password change", () => {
  const mustChange = getMockAuthMe({ username: "alice", mustChangePassword: true });

  it("keeps Update password disabled for a 7-character password", async () => {
    await renderApp({ routes: [sessionOf(mustChange)] });
    await chooseNewPassword({ password: "abcdefg", confirmation: "abcdefg" });

    expect(isDisabled("Update password")).toBe(true);
  });

  it("keeps Update password disabled when the confirmation does not match", async () => {
    await renderApp({ routes: [sessionOf(mustChange)] });
    await chooseNewPassword({ password: "abcdefgh", confirmation: "abcdefgX" });

    expect(isDisabled("Update password")).toBe(true);
  });

  it("enables Update password for an 8-character password that matches the confirmation", async () => {
    await renderApp({ routes: [sessionOf(mustChange)] });
    await chooseNewPassword({ password: "abcdefgh", confirmation: "abcdefgh" });

    expect(isDisabled("Update password")).toBe(false);
  });

  it("sends the username and the new password to the server", async () => {
    const { requests } = await renderApp({
      routes: [
        { method: "PATCH", path: "/api/auth/profile", respond: { json: { ok: true } } },
        sessionOf(mustChange, getMockAuthMe({ username: "alice" })),
      ],
    });
    await chooseNewPassword({ password: "abcdefgh", confirmation: "abcdefgh" });
    await press("Update password");

    expect(requests).toContainEqual({
      method: "PATCH",
      path: "/api/auth/profile",
      body: { username: "alice", newPassword: "abcdefgh" },
    });
  });

  it("opens the workspace once the password is updated", async () => {
    await renderApp({
      routes: [
        { method: "PATCH", path: "/api/auth/profile", respond: { json: { ok: true } } },
        sessionOf(mustChange, getMockAuthMe({ username: "alice" })),
      ],
    });
    await chooseNewPassword({ password: "abcdefgh", confirmation: "abcdefgh" });
    await press("Update password");

    expect(showsWorkspaceFor("alice")).toBe(true);
  });

  it("shows the server's message and stays on the screen when the update is rejected", async () => {
    await renderApp({
      routes: [
        sessionOf(mustChange),
        { method: "PATCH", path: "/api/auth/profile", respond: { status: 400, text: "Password too common" } },
      ],
    });
    await chooseNewPassword({ password: "abcdefgh", confirmation: "abcdefgh" });
    await press("Update password");

    expect(screen.getByText("Password too common")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Set a new password" })).toBeTruthy();
  });

  it("shows the operator's username on the password change screen", async () => {
    await renderApp({ routes: [sessionOf(mustChange)] });

    expect(screen.getByText("alice")).toBeTruthy();
  });

  it("ignores surrounding spaces when checking the password length", async () => {
    await renderApp({ routes: [sessionOf(mustChange)] });
    await chooseNewPassword({ password: "abcdefg ", confirmation: "abcdefg " });

    expect(isDisabled("Update password")).toBe(true);
  });

  it("ignores surrounding spaces when comparing the password with its confirmation", async () => {
    await renderApp({ routes: [sessionOf(mustChange)] });
    await chooseNewPassword({ password: "abcdefgh", confirmation: " abcdefgh " });

    expect(isDisabled("Update password")).toBe(false);
  });

  it("sends the password without surrounding spaces", async () => {
    const { requests } = await renderApp({
      routes: [
        { method: "PATCH", path: "/api/auth/profile", respond: { json: { ok: true } } },
        sessionOf(mustChange, getMockAuthMe({ username: "alice" })),
      ],
    });
    await chooseNewPassword({ password: "  abcdefgh  ", confirmation: "abcdefgh" });
    await press("Update password");

    expect(requests).toContainEqual({
      method: "PATCH",
      path: "/api/auth/profile",
      body: { username: "alice", newPassword: "abcdefgh" },
    });
  });

  it("shows Updating... on a disabled button while the update is pending", async () => {
    await renderApp({
      routes: [
        sessionOf(mustChange),
        { method: "PATCH", path: "/api/auth/profile", respond: () => new Promise(() => undefined) },
      ],
    });
    await chooseNewPassword({ password: "abcdefgh", confirmation: "abcdefgh" });
    await press("Update password");

    expect(isDisabled("Updating...")).toBe(true);
  });

  it("lets the operator try again after a rejected update", async () => {
    await renderApp({
      routes: [
        sessionOf(mustChange),
        { method: "PATCH", path: "/api/auth/profile", respond: { status: 400, text: "Password too common" } },
      ],
    });
    await chooseNewPassword({ password: "abcdefgh", confirmation: "abcdefgh" });
    await press("Update password");

    expect(isDisabled("Update password")).toBe(false);
  });

  it("returns to the sign-in form when the session cannot be read after the update", async () => {
    await renderApp({
      routes: [
        { method: "PATCH", path: "/api/auth/profile", respond: { json: { ok: true } } },
        { path: "/api/auth/me", respondInOrder: [{ json: mustChange }, { status: 401, text: "Unauthorized" }] },
      ],
    });
    await chooseNewPassword({ password: "abcdefgh", confirmation: "abcdefgh" });
    await press("Update password");

    expect(showsSignInForm()).toBe(true);
  });
});

describe("Signing out", () => {
  const signedIn = sessionOf(getMockAuthMe({ username: "alice" }));
  const logout: FakeRoute = { method: "POST", path: "/api/auth/logout", respond: { json: { ok: true } } };

  it("tells the server and returns to the sign-in form", async () => {
    const { requests } = await renderApp({ routes: [signedIn, logout] });
    await press("Sign out (alice)");

    expect(requests).toContainEqual({ method: "POST", path: "/api/auth/logout", body: undefined });
    expect(showsSignInForm()).toBe(true);
  });

  it("returns to the sign-in form from the password change screen", async () => {
    await renderApp({
      routes: [sessionOf(getMockAuthMe({ username: "alice", mustChangePassword: true })), logout],
    });
    await press("Sign out");

    expect(showsSignInForm()).toBe(true);
  });

  it("returns to the sign-in form even when the server rejects the sign-out", async () => {
    await renderApp({
      routes: [
        signedIn,
        { method: "POST", path: "/api/auth/logout", respond: { status: 500, text: "Server error" } },
      ],
    });
    await press("Sign out (alice)");

    expect(showsSignInForm()).toBe(true);
  });

  it("prefills the sign-in form with the last operator's username and an empty password", async () => {
    await renderApp({
      routes: [noSessionUntilSignIn(getMockAuthMe({ username: "alice" })), logout,
        { method: "POST", path: "/api/auth/login", respond: { json: { ok: true } } }],
    });
    await signIn({ username: "alice", password: "s3cret-pass" });
    await press("Sign out (alice)");

    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("alice");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });

  it("clears a half-typed new password so the next operator starts empty", async () => {
    await renderApp({
      routes: [
        { path: "/api/auth/me", respondInOrder: [{ json: getMockAuthMe({ username: "alice", mustChangePassword: true }) }, { json: getMockAuthMe({ username: "bob", mustChangePassword: true }) }] },
        logout,
        { method: "POST", path: "/api/auth/login", respond: { json: { ok: true } } },
      ],
    });
    await chooseNewPassword({ password: "abcdefgh", confirmation: "abcdefgh" });
    await press("Sign out");
    await signIn({ username: "bob", password: "temporary-pass" });

    expect((screen.getByLabelText("New password") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Confirm new password") as HTMLInputElement).value).toBe("");
  });
});

import { describe, expect, it, vi } from "vitest";
import { createAuthSession, type AuthSnapshot } from "./auth-session";

const human = { id: "h1", username: "operator", isAdmin: true, mustChangePassword: false };
const response = (body: unknown) => new Response(JSON.stringify(body));
function deferred() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes,no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("live auth session capability", () => {
  it.each([
    [human, true], [{ ...human, isAdmin: false }, false], [{ id: "h1", username: "admin", mustChangePassword: false }, false],
    [{ ...human, isAdmin: "true" }, false], [{ ...human, isAdmin: 1 }, false], [{ ...human, mustChangePassword: true }, false],
    [{ ...human, username: "admin", isAdmin: false }, false], [{ ...human, username: "runner" }, true],
    [{ ...human, id: null }, false], [{ ...human, id: "" }, false], [{ ...human, mustChangePassword: "false" }, false],
  ])("derives capability conservatively from me %#", async (body, isAdmin) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(body));
    const session = createAuthSession(fetchMock);
    expect(session.getSnapshot()).toMatchObject({ authChecked: false, authenticated: false, isAdmin: false });
    const observed: AuthSnapshot[] = [];
    session.subscribe(() => observed.push(session.getSnapshot()));
    const result = await session.refreshAuth();
    expect(result).toBe(session.getSnapshot());
    expect(result).toMatchObject({ authChecked: true, isAdmin });
    expect(observed).toEqual([result]);
    expect(fetchMock.mock.calls[0]).toEqual(["/api/auth/me", { method: "GET", credentials: "include", cache: "no-store", signal: expect.any(AbortSignal) }]);
  });
  it.each([null, [], {}, { ...human, id: 12 }, { ...human, username: null }])("clears auth for malformed me %#", async body => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response(human)).mockResolvedValueOnce(response(body));
    const session = createAuthSession(fetchMock);
    await session.refreshAuth();
    expect(await session.refreshAuth()).toEqual({ authChecked: true, authenticated: false, username: null, userId: null, mustChangePassword: false, isAdmin: false });
  });
  it.each([new Response("SECRET", { status: 401 }), new Response("SECRET"), new Error("SECRET")])("clears auth for failed me %# without retaining errors", async failure => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response(human));
    if (failure instanceof Error) fetchMock.mockRejectedValueOnce(failure); else fetchMock.mockResolvedValueOnce(failure);
    const session = createAuthSession(fetchMock);
    await session.refreshAuth();
    expect(await session.refreshAuth()).toEqual({ authChecked: true, authenticated: false, username: null, userId: null, mustChangePassword: false, isAdmin: false });
  });
  it("retains stable snapshots and notifies only changes; unsubscribe removes listener", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => response(human));
    const session = createAuthSession(fetchMock);
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    const first = await session.refreshAuth();
    expect(await session.refreshAuth()).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    session.invalidateCatalogAuthority("h1");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("auth session request generations", () => {
  it.each([true,false])("returns null for obsolete account A refresh (obsolete first=%s)", async obsoleteFirst => {
    const a = deferred(); const b = deferred();
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const session = createAuthSession(fetchMock);
    const observed: AuthSnapshot[] = [];
    session.subscribe(() => observed.push(session.getSnapshot()));
    const old = session.refreshAuth(); const current = session.refreshAuth();
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    if (obsoleteFirst) { a.resolve(response(human)); expect(await old).toBeNull(); expect(observed).toEqual([]); }
    b.resolve(response({ ...human, id: "B" }));
    const winner = await current;
    expect(winner).toMatchObject({ userId: "B", isAdmin: true });
    if (!obsoleteFirst) { a.resolve(response(human)); expect(await old).toBeNull(); }
    expect(session.getSnapshot()).toBe(winner);
    expect(observed).toEqual([winner]);
  });
  it("only the last overlapping focus/selection/mutation recheck can authorize", async () => {
    const checks = [deferred(), deferred(), deferred()];
    const fetchMock = vi.fn<typeof fetch>();
    for (const check of checks) fetchMock.mockReturnValueOnce(check.promise);
    const session = createAuthSession(fetchMock);
    const focus = session.refreshAuth(); const selection = session.refreshAuth(); const mutation = session.refreshAuth();
    checks[1]!.resolve(response(human)); expect(await selection).toBeNull();
    checks[2]!.resolve(response(human)); const winner = await mutation;
    checks[0]!.reject(new Error("SECRET late failure")); expect(await focus).toBeNull();
    expect(session.getSnapshot()).toBe(winner);
  });
  it("does not restore authority from a late me response after logout", async () => {
    const late = deferred(); const post = deferred();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response(human)).mockReturnValueOnce(late.promise).mockReturnValueOnce(post.promise);
    const session = createAuthSession(fetchMock);
    await session.refreshAuth();
    const checking = session.refreshAuth();
    const logout = session.logout();
    expect(session.getSnapshot()).toMatchObject({ authenticated: false, isAdmin: false, userId: null });
    expect(fetchMock.mock.calls[2]).toEqual(["/api/auth/logout", { method: "POST", credentials: "include", cache: "no-store" }]);
    late.resolve(response(human)); expect(await checking).toBeNull();
    post.reject(new Error("SECRET logout failure")); await logout;
    expect(session.getSnapshot()).toMatchObject({ authenticated: false, isAdmin: false });
  });
  it("matching invalidation clears capability and pending results before explicit recheck", async () => {
    const pending = deferred();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response(human)).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response({ ...human, mustChangePassword: true }));
    const session = createAuthSession(fetchMock); await session.refreshAuth();
    const check = session.refreshAuth(); session.invalidateCatalogAuthority("h1");
    expect(session.getSnapshot()).toMatchObject({ authenticated: true, isAdmin: false });
    pending.resolve(response(human)); expect(await check).toBeNull();
    expect(await session.refreshAuth()).toMatchObject({ mustChangePassword: true, isAdmin: false });
  });
  it("delayed A denial cannot demote B or invalidate B's pending refresh", async () => {
    const pending = deferred();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response(human)).mockResolvedValueOnce(response({ ...human, id: "B" })).mockReturnValueOnce(pending.promise);
    const session = createAuthSession(fetchMock); await session.refreshAuth();
    const b = await session.refreshAuth(); const checkingB = session.refreshAuth();
    session.invalidateCatalogAuthority("h1");
    expect(session.getSnapshot()).toBe(b);
    expect(fetchMock.mock.calls[2]![1]!.signal!.aborted).toBe(false);
    pending.resolve(response({ ...human, id: "B" })); expect(await checkingB).toBe(b);
    session.invalidateCatalogAuthority("B"); expect(session.getSnapshot().isAdmin).toBe(false);
  });
  it("dispose cancels and clears the old session, while a fresh lifecycle remains usable", async () => {
    const pending = deferred();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response(human)).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response(human));
    const session = createAuthSession(fetchMock); await session.refreshAuth();
    const checking = session.refreshAuth(); session.dispose();
    expect(session.getSnapshot()).toMatchObject({ authenticated: false, isAdmin: false });
    pending.resolve(response(human)); expect(await checking).toBeNull();
    expect(await session.refreshAuth()).toBeNull();
    const next = createAuthSession(fetchMock);
    expect(await next.refreshAuth()).toMatchObject({ authenticated: true, isAdmin: true });
  });
});

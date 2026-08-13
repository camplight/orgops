import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch, apiJson, getApiHeaders } from "./api";
import type { AuthMe, Channel, EventRow } from "./types";

function formatTime(value?: number) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function messageText(event: EventRow) {
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const text = (payload as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function sourceLabel(source: string) {
  if (source.startsWith("human:")) return source.slice("human:".length) || "Human";
  if (source.startsWith("agent:")) return source.slice("agent:".length) || "Agent";
  return source || "System";
}

function messageRole(source: string) {
  if (source.startsWith("human:")) return "human";
  if (source.startsWith("agent:")) return "agent";
  return "system";
}

function channelLabel(channel?: Channel | null) {
  if (!channel) return "Select a channel";
  return `# ${channel.name}`;
}

export default function App() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [channelQuery, setChannelQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [username, setUsername] = useState("");
  const [loginUsername, setLoginUsername] = useState("admin");
  const [loginPassword, setLoginPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [activeChannelId, channels]
  );

  const visibleMessages = useMemo(
    () => events.filter((event) => event.type === "message.created"),
    [events]
  );

  const filteredChannels = useMemo(() => {
    const query = channelQuery.trim().toLowerCase();
    if (!query) return channels;
    return channels.filter((channel) => channel.name.toLowerCase().includes(query));
  }, [channelQuery, channels]);

  async function loadSession() {
    setAuthLoading(true);
    setError(null);
    try {
      const me = await apiJson<AuthMe>("/api/auth/me");
      const nextUsername = me.username ?? "";
      setUsername(nextUsername);
      setLoginUsername(nextUsername || "admin");
      setAuthenticated(Boolean(nextUsername));
    } catch {
      setAuthenticated(false);
      setUsername("");
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadShell() {
    if (!authenticated) return;
    setError(null);
    setLoading(true);
    try {
      const nextChannels = await apiJson<Channel[]>("/api/channels");
      setChannels(nextChannels);
      setActiveChannelId((current) => current ?? nextChannels[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load OrgOps");
    } finally {
      setLoading(false);
    }
  }

  async function loadMessages(channelId: string) {
    try {
      const nextEvents = await apiJson<EventRow[]>(
        `/api/events?channelId=${encodeURIComponent(channelId)}&limit=100`
      );
      setEvents(nextEvents);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load messages");
    }
  }

  useEffect(() => {
    document.title = "OrgOps User UI";
    void loadSession();
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void loadShell();
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    if (!activeChannelId) {
      setEvents([]);
      return;
    }
    void loadMessages(activeChannelId);
    const interval = window.setInterval(() => void loadMessages(activeChannelId), 5000);
    return () => window.clearInterval(interval);
  }, [activeChannelId, authenticated]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setAuthLoading(true);
    try {
      await apiFetch("/api/auth/login", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword
        })
      });
      setLoginPassword("");
      await loadSession();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Unable to sign in");
      setAuthenticated(false);
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setAuthenticated(false);
    setUsername("");
    setChannels([]);
    setEvents([]);
    setActiveChannelId(null);
    setChannelQuery("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeChannelId || !draft.trim()) return;

    setSending(true);
    setError(null);
    try {
      await apiFetch("/api/events", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          type: "message.created",
          payload: { text: draft.trim() },
          source: `human:${username || "user"}`,
          channelId: activeChannelId
        })
      });
      setDraft("");
      await loadMessages(activeChannelId);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send message");
    } finally {
      setSending(false);
    }
  }

  if (authLoading && !authenticated) {
    return <main className="loading-screen">Loading OrgOps...</main>;
  }

  if (!authenticated) {
    return (
      <main className="login-screen">
        <section className="login-copy">
          <div className="brand-mark large">OO</div>
          <p>OrgOps User Workspace</p>
          <h1>Welcome back</h1>
          <span>Sign in to talk to your team and agents.</span>
        </section>

        <form className="login-card" onSubmit={handleLogin}>
          <div>
            <span>Sign in</span>
            <strong>OrgOps</strong>
          </div>
          {error ? <div className="notice error">{error}</div> : null}
          <label>
            Username
            <input
              value={loginUsername}
              onChange={(event) => setLoginUsername(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          <button disabled={!loginUsername.trim() || !loginPassword || authLoading}>
            {authLoading ? "Signing in..." : "Continue"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">OO</div>
          <div>
            <strong>OrgOps</strong>
            <span>User workspace</span>
          </div>
        </div>

        <section className="sidebar-section">
          <div className="section-label">Channels</div>
          <label className="channel-search">
            <span>Search channels</span>
            <input
              value={channelQuery}
              onChange={(event) => setChannelQuery(event.target.value)}
              placeholder="Search channels..."
            />
          </label>
          <div className="channel-list">
            {filteredChannels.map((channel) => (
              <button
                key={channel.id}
                className={channel.id === activeChannelId ? "active" : undefined}
                onClick={() => setActiveChannelId(channel.id)}
              >
                <span># {channel.name}</span>
                {channel.participants?.length ? <em>{channel.participants.length}</em> : null}
              </button>
            ))}
            {filteredChannels.length === 0 ? (
              <p className="channel-empty">No channels match "{channelQuery.trim()}".</p>
            ) : null}
          </div>
        </section>

        <section className="sidebar-section account-actions">
          <button className="logout-button" onClick={() => void handleLogout()}>
            Sign out {username ? `(${username})` : ""}
          </button>
        </section>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <span>Workspace</span>
            <h1>{channelLabel(activeChannel)}</h1>
            <p>{activeChannel?.description || "Talk to the team and agents in plain language."}</p>
          </div>
          <button className="refresh-button" onClick={() => void loadShell()}>
            Refresh
          </button>
        </header>

        {error ? <div className="notice error">{error}</div> : null}
        {loading ? <div className="notice">Loading OrgOps...</div> : null}

        <section className="messages-panel">
          {visibleMessages.length === 0 ? (
            <div className="empty-state">
              <strong>No messages yet</strong>
              <p>Send a short update or request to start the conversation.</p>
            </div>
          ) : (
            visibleMessages.map((event) => {
              const role = messageRole(event.source);
              return (
                <article className={`message message-${role}`} key={event.id}>
                  <div className="message-meta">
                    <strong>{sourceLabel(event.source)}</strong>
                    <span>{formatTime(event.createdAt)}</span>
                  </div>
                  <p>{messageText(event)}</p>
                </article>
              );
            })
          )}
        </section>

        <form className="composer" onSubmit={handleSubmit}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={
              activeChannel ? `Message ${channelLabel(activeChannel)}` : "Select a channel first"
            }
            disabled={!activeChannel || sending}
            rows={3}
          />
          <button disabled={!activeChannel || !draft.trim() || sending}>
            {sending ? "Sending..." : "Send"}
          </button>
        </form>
      </section>

      <aside className="activity-panel">
        <section>
          <h2>Recent Activity</h2>
          <div className="activity-list">
            {events.slice(-6).reverse().map((event) => (
              <article key={event.id}>
                <strong>{sourceLabel(event.source)}</strong>
                <span>{event.type.replaceAll(".", " ")}</span>
              </article>
            ))}
            {events.length === 0 ? <p>No recent activity in this channel.</p> : null}
          </div>
        </section>
      </aside>
    </main>
  );
}

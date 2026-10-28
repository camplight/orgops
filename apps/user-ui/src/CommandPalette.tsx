import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

export type PaletteChannel = {
  id: string;
  name: string;
  kind: "channel" | "direct";
  description?: string | null;
  archived: boolean;
  pinned: boolean;
  unread: number;
};

type PaletteItem =
  | { type: "channel"; key: string; channel: PaletteChannel; matches: number[] }
  | { type: "new-conversation"; key: string; name: string };

type Section = { label: string; items: PaletteItem[] };

type FuzzyMatch = { score: number; indices: number[] };

const MAX_RESULTS = 50;
const MAX_RECENTS = 6;

function fuzzyMatch(text: string, query: string): FuzzyMatch | null {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase().replace(/\s+/g, "");
  if (!needle) return { score: 0, indices: [] };

  const substringAt = haystack.indexOf(needle);
  if (substringAt >= 0) {
    const atWordStart = substringAt === 0 || /[^a-z0-9]/.test(haystack[substringAt - 1]);
    return {
      score: 1000 - substringAt + (atWordStart ? 200 : 0) + (substringAt === 0 ? 300 : 0),
      indices: Array.from({ length: needle.length }, (_, offset) => substringAt + offset)
    };
  }

  const indices: number[] = [];
  let score = 0;
  let cursor = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found < 0) return null;
    const previous = indices[indices.length - 1];
    if (previous !== undefined && found === previous + 1) score += 15;
    const boundary = found === 0 || /[^a-z0-9]/.test(haystack[found - 1]);
    const camelHump = found > 0 && text[found] !== haystack[found] && text[found - 1] === haystack[found - 1];
    if (boundary || camelHump) score += 25;
    score -= Math.min(found - cursor, 10);
    indices.push(found);
    cursor = found + 1;
  }
  return { score, indices };
}

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const marked = new Set(indices);
  const parts: { text: string; marked: boolean }[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const isMarked = marked.has(index);
    const last = parts[parts.length - 1];
    if (last && last.marked === isMarked) last.text += text[index];
    else parts.push({ text: text[index], marked: isMarked });
  }
  return (
    <>
      {parts.map((part, index) => (part.marked ? <mark key={index}>{part.text}</mark> : part.text))}
    </>
  );
}

export function CommandPalette({
  channels,
  recentChannelIds,
  activeChannelId,
  onSelectChannel,
  onNewConversation,
  onClose
}: {
  channels: PaletteChannel[];
  recentChannelIds: string[];
  activeChannelId: string | null;
  onSelectChannel: (channelId: string) => void;
  onNewConversation: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sections = useMemo<Section[]>(() => {
    const trimmed = query.trim();
    const recencyRank = new Map(recentChannelIds.map((id, index) => [id, index]));
    const newConversation: PaletteItem = {
      type: "new-conversation",
      key: "action:new-conversation",
      name: trimmed
    };

    if (!trimmed) {
      const byId = new Map(channels.map((channel) => [channel.id, channel]));
      const recents = recentChannelIds
        .filter((id) => id !== activeChannelId)
        .map((id) => byId.get(id))
        .filter((channel): channel is PaletteChannel => Boolean(channel && !channel.archived))
        .slice(0, MAX_RECENTS);
      const recentIds = new Set(recents.map((channel) => channel.id));
      const rest = channels
        .filter((channel) => !channel.archived && !recentIds.has(channel.id))
        .sort((left, right) => {
          if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
          if (Boolean(left.unread) !== Boolean(right.unread)) return left.unread ? -1 : 1;
          return left.name.localeCompare(right.name);
        });
      const toItem = (channel: PaletteChannel): PaletteItem => ({
        type: "channel",
        key: channel.id,
        channel,
        matches: []
      });
      return [
        { label: "Actions", items: [newConversation] },
        { label: "Recent", items: recents.map(toItem) },
        { label: "Channels", items: rest.map(toItem) }
      ].filter((section) => section.items.length > 0);
    }

    const ranked = channels
      .map((channel) => {
        const match = fuzzyMatch(channel.name, trimmed);
        if (!match) return null;
        const recency = recencyRank.get(channel.id);
        const score =
          match.score +
          (recency !== undefined ? 40 - recency * 4 : 0) +
          (channel.pinned ? 20 : 0) -
          (channel.archived ? 300 : 0);
        return { channel, match, score };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((left, right) => right.score - left.score || left.channel.name.localeCompare(right.channel.name))
      .slice(0, MAX_RESULTS);

    return [
      {
        label: "Channels",
        items: ranked.map(({ channel, match }) => ({
          type: "channel" as const,
          key: channel.id,
          channel,
          matches: match.indices
        }))
      },
      { label: "Actions", items: [newConversation] }
    ].filter((section) => section.items.length > 0);
  }, [activeChannelId, channels, query, recentChannelIds]);

  const flatItems = useMemo(() => sections.flatMap((section) => section.items), [sections]);

  useEffect(() => {
    const firstRecent = query.trim() ? -1 : flatItems.findIndex((item) => item.type === "channel");
    setCursor(sections.some((section) => section.label === "Recent") && firstRecent >= 0 ? firstRecent : 0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-palette-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function runItem(item: PaletteItem | undefined) {
    if (!item) return;
    if (item.type === "channel") onSelectChannel(item.channel.id);
    else onNewConversation(item.name);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
      event.preventDefault();
      setCursor((current) => (flatItems.length ? (current + 1) % flatItems.length : 0));
    } else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
      event.preventDefault();
      setCursor((current) => (flatItems.length ? (current - 1 + flatItems.length) % flatItems.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runItem(flatItems[cursor]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  let itemIndex = -1;
  const activeItem = flatItems[cursor];

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Jump to channel"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input-row">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Jump to a channel or start a conversation…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={activeItem ? `palette-item-${cursor}` : undefined}
            spellCheck={false}
            autoComplete="off"
          />
          <kbd>esc</kbd>
        </div>

        <div className="palette-results" id="palette-results" role="listbox" ref={listRef}>
          {sections.map((section) => (
            <div className="palette-section" key={section.label} role="group" aria-label={section.label}>
              <div className="palette-section-label">{section.label}</div>
              {section.items.map((item) => {
                itemIndex += 1;
                const index = itemIndex;
                const selected = index === cursor;
                return (
                  <button
                    type="button"
                    key={item.key}
                    id={`palette-item-${index}`}
                    data-palette-index={index}
                    role="option"
                    aria-selected={selected}
                    className={`palette-item${selected ? " selected" : ""}`}
                    onMouseMove={() => {
                      if (cursor !== index) setCursor(index);
                    }}
                    onClick={() => runItem(item)}
                  >
                    {item.type === "channel" ? (
                      <>
                        <span className={`palette-item-icon${item.channel.pinned ? " pinned" : ""}`}>
                          {item.channel.kind === "direct" ? <i className="palette-direct-dot" /> : "#"}
                        </span>
                        <span className="palette-item-text">
                          <strong>
                            <Highlighted text={item.channel.name} indices={item.matches} />
                          </strong>
                          {item.channel.description ? <small>{item.channel.description}</small> : null}
                        </span>
                        {item.channel.archived ? <span className="palette-tag">Archived</span> : null}
                        {item.channel.id === activeChannelId ? <span className="palette-tag">Current</span> : null}
                        {item.channel.unread ? <em className="palette-unread">{item.channel.unread}</em> : null}
                      </>
                    ) : (
                      <>
                        <span className="palette-item-icon palette-item-icon-action">+</span>
                        <span className="palette-item-text">
                          <strong>{item.name ? `New conversation “${item.name}”` : "New conversation"}</strong>
                          <small>Start a channel with agents, teams, or people</small>
                        </span>
                      </>
                    )}
                    {selected ? <kbd className="palette-enter">↵</kbd> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <footer className="palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </footer>
      </section>
    </div>
  );
}

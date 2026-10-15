import { MessageMarkdown } from "./message-markdown";

type SensitiveContentProps = {
  eventId: string;
  hint: string | undefined;
  revealedText: string;
  revealedAsMarkdown: boolean;
  password: string;
  error: string;
  revealing: boolean;
  canPost: boolean;
  channelId: string | null;
  username: string;
  onPasswordChange: (value: string) => void;
  onReveal: () => void;
  onHide: () => void;
};

export function SensitiveContent({
  eventId,
  hint,
  revealedText,
  revealedAsMarkdown,
  password,
  error,
  revealing,
  canPost,
  channelId,
  username,
  onPasswordChange,
  onReveal,
  onHide
}: SensitiveContentProps) {
  return (
    <section className="message-sensitive">
      <div className="message-sensitive-head">
        <strong>Sensitive content</strong>
        <span>Protected</span>
      </div>
      {hint ? <p>{hint}</p> : null}
      {revealedText ? (
        <div className="message-sensitive-revealed">
          {revealedAsMarkdown ? (
            <MessageMarkdown
              text={revealedText}
              keyPrefix={`${eventId}-sensitive`}
              canPost={canPost}
              channelId={channelId}
              username={username}
            />
          ) : (
            <pre>{revealedText}</pre>
          )}
          <button type="button" onClick={onHide}>
            Hide sensitive content
          </button>
        </div>
      ) : (
        <div className="message-sensitive-controls">
          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(changeEvent) => onPasswordChange(changeEvent.target.value)}
              placeholder="Enter your password"
            />
          </label>
          <button
            type="button"
            disabled={revealing || !password}
            onClick={onReveal}
          >
            {revealing ? "Revealing..." : "Reveal sensitive content"}
          </button>
        </div>
      )}
      {error ? <p className="message-sensitive-error">{error}</p> : null}
    </section>
  );
}

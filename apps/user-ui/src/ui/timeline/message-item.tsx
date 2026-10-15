import { parseMessageAttachments } from "../../domain/messaging/attachments";
import {
  messageDisplayTime,
  messageRole,
  messageText,
  sensitiveMessagePayload,
  sourceLabel
} from "../../domain/messaging/event-interpretation";
import { shouldRenderMarkdown } from "../../domain/messaging/markdown-detection";
import { formatTime } from "../../domain/messaging/time-format";
import type { EventRow } from "../../types";
import { MessageAttachments } from "./message-attachments";
import { MessageMarkdown } from "./message-markdown";
import { SensitiveContent } from "./sensitive-content";

type MessageItemProps = {
  event: EventRow;
  canPost: boolean;
  channelId: string | null;
  username: string;
  revealedSensitive: string;
  revealError: string;
  revealPassword: string;
  revealing: boolean;
  onPasswordChange: (value: string) => void;
  onReveal: () => void;
  onHide: () => void;
};

export function MessageItem({
  event,
  canPost,
  channelId,
  username,
  revealedSensitive,
  revealError,
  revealPassword,
  revealing,
  onPasswordChange,
  onReveal,
  onHide
}: MessageItemProps) {
  const role = messageRole(event.source);
  const attachments = parseMessageAttachments(event.payload);
  const text = messageText(event);
  const markdown = shouldRenderMarkdown(text);
  const sensitive = sensitiveMessagePayload(event);
  return (
    <article className={`message message-${role}`}>
      <div className="message-meta">
        <strong>{sourceLabel(event.source)}</strong>
        <span>{formatTime(messageDisplayTime(event))}</span>
      </div>
      {markdown ? (
        <MessageMarkdown
          text={text}
          keyPrefix={event.id}
          canPost={canPost}
          channelId={channelId}
          username={username}
        />
      ) : (
        <p>{text}</p>
      )}
      {sensitive ? (
        <SensitiveContent
          eventId={event.id}
          hint={sensitive.hint}
          revealedText={revealedSensitive}
          revealedAsMarkdown={shouldRenderMarkdown(revealedSensitive)}
          password={revealPassword}
          error={revealError}
          revealing={revealing}
          canPost={canPost}
          channelId={channelId}
          username={username}
          onPasswordChange={onPasswordChange}
          onReveal={onReveal}
          onHide={onHide}
        />
      ) : null}
      {attachments.length > 0 ? (
        <MessageAttachments eventId={event.id} attachments={attachments} />
      ) : null}
    </article>
  );
}

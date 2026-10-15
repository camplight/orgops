import { sourceLabel } from "../../domain/messaging/event-interpretation";
import { classifyTurnFailure, turnFailureText } from "../../domain/messaging/trace-rules";
import type { EventRow } from "../../types";

type TurnFailureItemProps = {
  event: EventRow;
  createdAtLabel: string;
};

export function TurnFailureItem({ event, createdAtLabel }: TurnFailureItemProps) {
  const rawText = turnFailureText(event);
  const failure = classifyTurnFailure(rawText);
  return (
    <article className="message message-error">
      <div className="message-meta">
        <strong>System · {sourceLabel(event.source)}</strong>
        <span>{createdAtLabel}</span>
      </div>
      <h3 className="message-error-title">{failure.title}</h3>
      <p>{failure.message}</p>
      <details className="turn-failure-details">
        <summary>Technical details</summary>
        <pre>{rawText}</pre>
      </details>
    </article>
  );
}

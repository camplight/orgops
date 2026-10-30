import { FormEvent, useState } from "react";
import { apiFetch, getApiHeaders } from "./api";
import type { SecretInputSpec } from "./secretInputMarkdown";

type OrgopsSecretInputProps = {
  spec: SecretInputSpec;
  agentName?: string;
};

function errorText(error: unknown) {
  const detail = error instanceof Error ? error.message : "Unable to save secret";
  try {
    const parsed = JSON.parse(detail) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    // Response body is already plain text.
  }
  return detail || "Unable to save secret";
}

type SubmitTone = "success" | "error";

export function OrgopsSecretInput({ spec, agentName = "" }: OrgopsSecretInputProps) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ tone: SubmitTone; text: string } | null>(null);

  const agent = agentName.trim();
  const explicitScope = spec.scopeType.trim().length > 0 && spec.scopeType !== "package";
  const canSubmit = spec.key.trim().length > 0 && (explicitScope || agent.length > 0);
  const label = spec.label || `Set secret ${spec.key}`;
  const submitLabel = spec.submitLabel || "Save secret";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    if (!value) {
      setStatus({ tone: "error", text: "Enter a value before saving." });
      return;
    }
    setSubmitting(true);
    setStatus(null);
    try {
      const body: Record<string, string> = {
        key: spec.key,
        value,
      };
      if (explicitScope) {
        body.scopeType = spec.scopeType;
        if (spec.scopeId) body.scopeId = spec.scopeId;
        else if (spec.scopeType === "private" && agent) body.scopeId = agent;
      } else {
        body.scopeType = "private";
        body.scopeId = agent;
      }
      await apiFetch("/api/secrets", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify(body),
      });
      setValue("");
      setStatus({ tone: "success", text: `Saved ${spec.key}.` });
    } catch (error) {
      setStatus({ tone: "error", text: errorText(error) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="orgops-secret-input" onSubmit={(event) => void handleSubmit(event)}>
      <div className="orgops-secret-input-head">
        <strong>{label}</strong>
        <code>
          {explicitScope
            ? `${spec.scopeType}${spec.scopeId ? `/${spec.scopeId}` : ""}/${spec.key}`
            : `only ${agent || "this agent"} · ${spec.key}`}
        </code>
      </div>
      {spec.description ? <p>{spec.description}</p> : null}
      <label>
        <span>Value</span>
        <input
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Enter secret value"
          autoComplete="off"
        />
      </label>
      <button disabled={!canSubmit || submitting || !value} type="submit">
        {submitting ? "Saving..." : submitLabel}
      </button>
      {status ? (
        <p className={`orgops-secret-input-status orgops-secret-input-status-${status.tone}`}>{status.text}</p>
      ) : null}
    </form>
  );
}

import { FormEvent, useState } from "react";
import { apiFetch, getApiHeaders } from "./api";
import type { SecretInputSpec } from "./secretInputMarkdown";

type OrgopsSecretInputProps = {
  spec: SecretInputSpec;
};

type SubmitTone = "success" | "error";

export function OrgopsSecretInput({ spec }: OrgopsSecretInputProps) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ tone: SubmitTone; text: string } | null>(null);

  const canSubmit = spec.packageId.trim().length > 0 && spec.key.trim().length > 0;
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
        package: spec.packageId,
        key: spec.key,
        value,
      };
      if (spec.scopeType) body.scopeType = spec.scopeType;
      if (spec.scopeId) body.scopeId = spec.scopeId;
      await apiFetch("/api/secrets", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify(body),
      });
      setValue("");
      setStatus({ tone: "success", text: `Saved ${spec.key}.` });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unable to save secret";
      setStatus({ tone: "error", text: detail || "Unable to save secret" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="orgops-secret-input" onSubmit={(event) => void handleSubmit(event)}>
      <div className="orgops-secret-input-head">
        <strong>{label}</strong>
        <code>
          {spec.packageId}/{spec.key}
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

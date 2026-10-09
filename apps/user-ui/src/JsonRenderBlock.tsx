import { useMemo, useState } from "react";
import { apiFetch, getApiHeaders } from "./api";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  LineChart,
  Line,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type JsonRenderSpec = {
  root?: unknown;
  elements?: Record<string, JsonRenderElement>;
};

type JsonRenderElement = {
  type?: string;
  props?: Record<string, unknown>;
  children?: unknown;
  slots?: Record<string, unknown>;
};

type JsonRenderAction = {
  name?: string;
  type?: string;
  params?: Record<string, unknown>;
  payload?: Record<string, unknown>;
};

type SecretSetRequest = {
  package: string;
  key: string;
  value: string;
  scopeType?: string;
  scopeId?: string;
};

type ChartPoint = {
  label: string;
  value: number;
};

type JsonRenderBlockProps = {
  specText: string;
  channelId: string | null;
  username: string;
  canPost: boolean;
};

function parseSpec(specText: string): JsonRenderSpec {
  const parsed = JSON.parse(specText) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("json-render spec must be an object");
  }
  return parsed as JsonRenderSpec;
}

function textProp(props: Record<string, unknown> | undefined, ...names: string[]) {
  for (const name of names) {
    const value = props?.[name];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function stringArrayProp(props: Record<string, unknown> | undefined, ...names: string[]) {
  for (const name of names) {
    const value = props?.[name];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function recordArrayProp(props: Record<string, unknown> | undefined, ...names: string[]) {
  for (const name of names) {
    const value = props?.[name];
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    }
  }
  return [];
}

function actionProp(props: Record<string, unknown> | undefined): JsonRenderAction | null {
  const value = props?.action ?? props?.onClick ?? props?.submitAction;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRenderAction;
}

function mergedElementProps(element: JsonRenderElement): Record<string, unknown> {
  const flatEntries = Object.entries(element).filter(
    ([key]) => key !== "type" && key !== "props" && key !== "children" && key !== "slots"
  );
  const flatProps = Object.fromEntries(flatEntries);
  const nestedProps =
    element.props && typeof element.props === "object" && !Array.isArray(element.props)
      ? element.props
      : {};
  // Support both shapes: element.props.{...} and legacy flat element fields.
  return { ...flatProps, ...nestedProps };
}

function stableJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function nonEmptyString(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed;
}

function actionName(action: JsonRenderAction | null, fallbackLabel: string) {
  return action?.name || action?.type || fallbackLabel || "json_render_action";
}

function isSecretSetAction(name: string) {
  const normalized = name.trim().toLowerCase();
  return (
    normalized === "secret.set" ||
    normalized === "secrets.set" ||
    normalized === "orgops.secret.set"
  );
}

function resolveSecretSetRequest(
  params: Record<string, unknown>,
  values: Record<string, string | string[]>
): SecretSetRequest | { error: string } {
  const packageId = nonEmptyString(params.package ?? params.packageId);
  const key = nonEmptyString(params.key ?? params.name);
  if (!packageId) return { error: "Missing secret package in action params." };
  if (!key) return { error: "Missing secret key in action params." };

  const valueField = nonEmptyString(params.valueField ?? params.valueFrom ?? params.secretField);
  const directValue = nonEmptyString(params.value);
  let value = directValue;

  if (!value && valueField) {
    const picked = values[valueField];
    if (typeof picked === "string") value = picked;
  }

  // Fallback: if exactly one plain text field exists, use it as the secret value.
  if (!value && !valueField) {
    const scalarValues = Object.values(values).filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0
    );
    if (scalarValues.length === 1) {
      value = scalarValues[0];
    }
  }

  if (!value) {
    return {
      error:
        "Missing secret value. Provide action.params.valueField (or valueFrom) that points to a Question field."
    };
  }

  const scopeType = nonEmptyString(params.scopeType);
  const scopeId = nonEmptyString(params.scopeId);
  return {
    package: packageId,
    key,
    value,
    ...(scopeType ? { scopeType } : {}),
    ...(scopeId ? { scopeId } : {})
  };
}

function resolveSecretInputRequest(
  elementId: string,
  props: Record<string, unknown>,
  values: Record<string, string | string[]>
): SecretSetRequest | { error: string } {
  const packageId = nonEmptyString(props.package ?? props.packageId);
  const key = nonEmptyString(props.key ?? props.name);
  if (!packageId) return { error: "Missing secret package in SecretInput props." };
  if (!key) return { error: "Missing secret key in SecretInput props." };

  const valueField = nonEmptyString(props.valueField ?? props.valueFrom ?? props.secretField);
  let value = "";
  if (valueField) {
    const picked = values[valueField];
    if (typeof picked === "string") value = picked;
  } else {
    const direct = values[elementId];
    if (typeof direct === "string") value = direct;
  }
  if (!value) return { error: "Enter a secret value before saving." };

  const scopeType = nonEmptyString(props.scopeType);
  const scopeId = nonEmptyString(props.scopeId);
  return {
    package: packageId,
    key,
    value,
    ...(scopeType ? { scopeType } : {}),
    ...(scopeId ? { scopeId } : {})
  };
}

function childIds(element: JsonRenderElement) {
  const ids: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === "string") ids.push(value);
    if (Array.isArray(value)) value.forEach(collect);
  };
  collect(element.children);
  if (element.slots) {
    for (const slotValue of Object.values(element.slots)) collect(slotValue);
  }
  return ids;
}

function optionValue(option: unknown) {
  if (typeof option === "string") return { label: option, value: option, description: "" };
  if (!option || typeof option !== "object" || Array.isArray(option)) return null;
  const record = option as Record<string, unknown>;
  const label = textProp(record, "label", "title", "name", "text");
  const value = textProp(record, "value", "id", "key", "label", "title", "name") || label;
  const description = textProp(record, "description", "hint", "subtitle");
  if (!label && !value) return null;
  return { label: label || value, value, description };
}

function optionList(props: Record<string, unknown> | undefined) {
  const source = props?.options ?? props?.choices ?? props?.items ?? [];
  if (!Array.isArray(source)) return [];
  return source.map(optionValue).filter((item): item is { label: string; value: string; description: string } => Boolean(item));
}

function finiteNumber(value: unknown) {
  if (typeof value !== "number") return null;
  return Number.isFinite(value) ? value : null;
}

function chartPoint(entry: unknown, index: number): ChartPoint | null {
  const ordinalLabel = String(index + 1);
  if (typeof entry === "number") {
    const value = finiteNumber(entry);
    if (value === null) return null;
    return { label: ordinalLabel, value };
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const label =
    nonEmptyString(record.label) ||
    nonEmptyString(record.x) ||
    nonEmptyString(record.name) ||
    nonEmptyString(record.title) ||
    nonEmptyString(record.day) ||
    ordinalLabel;
  const value =
    finiteNumber(record.value) ??
    finiteNumber(record.y) ??
    finiteNumber(record.amount) ??
    finiteNumber(record.count);
  if (value === null) return null;
  return { label, value };
}

function chartPoints(props: Record<string, unknown>) {
  const source = props.data ?? props.values ?? props.series;
  if (!Array.isArray(source)) return [];
  return source
    .map((entry, index) => chartPoint(entry, index))
    .filter((entry): entry is ChartPoint => Boolean(entry));
}

export function JsonRenderBlock({ specText, channelId, username, canPost }: JsonRenderBlockProps) {
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const parsed = useMemo(() => {
    try {
      return { spec: parseSpec(specText), error: null as string | null };
    } catch (error) {
      return {
        spec: null,
        error: error instanceof Error ? error.message : "Invalid json-render spec"
      };
    }
  }, [specText]);

  if (parsed.error || !parsed.spec) {
    return (
      <div className="json-render-shell json-render-error">
        <strong>json-render preview failed</strong>
        <p>{parsed.error}</p>
        <pre>{specText}</pre>
      </div>
    );
  }

  const elements = parsed.spec.elements ?? {};
  const rootId = typeof parsed.spec.root === "string" ? parsed.spec.root : Object.keys(elements)[0];

  async function submitAction(action: JsonRenderAction | null, fallbackLabel: string, elementId: string) {
    const name = actionName(action, fallbackLabel);
    const secretAction = isSecretSetAction(name);
    if (!secretAction && (!channelId || !canPost)) return;
    const params = action?.params ?? action?.payload ?? {};
    setSubmittingAction(elementId);
    setStatus(null);
    try {
      if (secretAction) {
        const secretRequest = resolveSecretSetRequest(params, values);
        if ("error" in secretRequest) {
          setStatus(secretRequest.error);
          return;
        }
        await apiFetch("/api/secrets", {
          method: "POST",
          headers: getApiHeaders(),
          body: JSON.stringify(secretRequest)
        });
        setStatus(`Saved secret: ${secretRequest.package}/${secretRequest.key}`);
        return;
      }

      await apiFetch("/api/events", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          type: "message.created",
          source: `human:${username || "user"}`,
          channelId,
          payload: {
            eventType: "ui.json-render.action",
            text: [
              `json-render action: ${name}`,
              `element: ${elementId}`,
              `params: ${stableJson(params)}`,
              `formState: ${stableJson(values)}`
            ].join("\n")
          }
        })
      });
      setStatus(`Sent action: ${name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to send action");
    } finally {
      setSubmittingAction(null);
    }
  }

  async function submitSecretInput(elementId: string, props: Record<string, unknown>) {
    const request = resolveSecretInputRequest(elementId, props, values);
    if ("error" in request) {
      setStatus(request.error);
      return;
    }
    setSubmittingAction(elementId);
    setStatus(null);
    try {
      await apiFetch("/api/secrets", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify(request)
      });
      setValues((current) => ({ ...current, [elementId]: "" }));
      setStatus(`Saved secret: ${request.package}/${request.key}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save secret");
    } finally {
      setSubmittingAction(null);
    }
  }

  const renderChildren = (element: JsonRenderElement) => {
    const ids = childIds(element);
    if (ids.length === 0) return null;
    return <>{ids.map((id) => renderElement(id))}</>;
  };

  const renderElement = (id: string): React.ReactNode => {
    const element = elements[id];
    if (!element) return null;
    const props = mergedElementProps(element);
    const type = element.type || "Card";
    const title = textProp(props, "title", "label", "heading", "question");
    const description = textProp(props, "description", "subtitle", "body", "text", "helpText");
    const options = optionList(props);

    if (type === "Page") {
      return (
        <section className="json-render-page" key={id}>
          {title ? <h2>{title}</h2> : null}
          {description ? <p>{description}</p> : null}
          {renderChildren(element)}
        </section>
      );
    }

    if (type === "Section") {
      return (
        <section className="json-render-section" key={id}>
          {title ? <h3>{title}</h3> : null}
          {description ? <p>{description}</p> : null}
          {renderChildren(element)}
        </section>
      );
    }

    if (type === "Question") {
      return (
        <label className="json-render-question" key={id}>
          <span>{title || "Question"}</span>
          {description ? <em>{description}</em> : null}
          <textarea
            value={typeof values[id] === "string" ? values[id] : ""}
            onChange={(event) => setValues((current) => ({ ...current, [id]: event.target.value }))}
            placeholder={textProp(props, "placeholder") || "Type your answer..."}
            rows={3}
          />
        </label>
      );
    }

    if (type === "ChoiceList" || type === "IntegrationPicker") {
      const multiple = type === "IntegrationPicker" || props.multiple === true;
      const selectedValues = values[id];
      const selected = new Set(Array.isArray(selectedValues) ? selectedValues : typeof selectedValues === "string" ? [selectedValues] : []);
      return (
        <fieldset className="json-render-choice-list" key={id}>
          <legend>{title || (type === "IntegrationPicker" ? "Integrations" : "Choose an option")}</legend>
          {description ? <p>{description}</p> : null}
          <div>
            {options.map((option) => (
              <label key={option.value}>
                <input
                  type={multiple ? "checkbox" : "radio"}
                  name={`json-render-${id}`}
                  checked={selected.has(option.value)}
                  onChange={(event) => {
                    setValues((current) => {
                      if (!multiple) return { ...current, [id]: option.value };
                      const next = new Set(selected);
                      if (event.target.checked) next.add(option.value);
                      else next.delete(option.value);
                      return { ...current, [id]: [...next] };
                    });
                  }}
                />
                <span>
                  <strong>{option.label}</strong>
                  {option.description ? <em>{option.description}</em> : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      );
    }

    if (type === "Checklist") {
      const items = recordArrayProp(props, "items", "steps");
      const labels = items.length > 0 ? items.map((item) => textProp(item, "label", "title", "text")) : stringArrayProp(props, "items", "steps");
      return (
        <section className="json-render-card" key={id}>
          {title ? <h3>{title}</h3> : null}
          {description ? <p>{description}</p> : null}
          <ul className="json-render-checklist">
            {labels.filter(Boolean).map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
          {renderChildren(element)}
        </section>
      );
    }

    if (type === "Recommendation") {
      const confidence = textProp(props, "confidence", "score");
      return (
        <section className="json-render-recommendation" key={id}>
          <span>Recommendation{confidence ? ` · ${confidence}` : ""}</span>
          {title ? <h3>{title}</h3> : null}
          {description ? <p>{description}</p> : null}
          {renderChildren(element)}
        </section>
      );
    }

    if (type === "BarGraph") {
      const points = chartPoints(props);
      return (
        <section className="json-render-card json-render-chart" key={id}>
          {title ? <h3>{title}</h3> : null}
          {description ? <p>{description}</p> : null}
          {points.length === 0 ? (
            <p>No chart data.</p>
          ) : (
            <div className="json-render-chart-host" role="img" aria-label={title || "Bar chart"}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={points} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe6ef" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#475569" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#475569" }} />
                  <Tooltip formatter={(value) => [String(value), "Value"]} />
                  <Bar dataKey="value" fill="#0f766e" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {renderChildren(element)}
        </section>
      );
    }

    if (type === "LineGraph") {
      const points = chartPoints(props);
      return (
        <section className="json-render-card json-render-chart" key={id}>
          {title ? <h3>{title}</h3> : null}
          {description ? <p>{description}</p> : null}
          {points.length === 0 ? (
            <p>No chart data.</p>
          ) : (
            <div className="json-render-chart-host" role="img" aria-label={title || "Line chart"}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={points} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe6ef" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#475569" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#475569" }} />
                  <Tooltip formatter={(value) => [String(value), "Value"]} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#0f766e"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "#0f766e" }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {renderChildren(element)}
        </section>
      );
    }

    if (type === "ActionButton") {
      const action = actionProp(props);
      const name = actionName(action, title);
      const secretAction = isSecretSetAction(name);
      return (
        <button
          className="json-render-action"
          disabled={(!secretAction && (!channelId || !canPost)) || submittingAction === id}
          key={id}
          onClick={() => void submitAction(action, title, id)}
          type="button"
        >
          {submittingAction === id
            ? secretAction
              ? "Saving..."
              : "Sending..."
            : title || action?.name || "Run action"}
        </button>
      );
    }

    if (type === "SecretInput") {
      const packageId = textProp(props, "package", "packageId");
      const key = textProp(props, "key", "name");
      const submitLabel = textProp(props, "submitLabel", "submit-label") || "Save secret";
      const placeholder = textProp(props, "placeholder") || "Enter secret value";
      return (
        <section className="json-render-card json-render-secret-input" key={id}>
          {title ? <h3>{title}</h3> : null}
          {description ? <p>{description}</p> : null}
          <label>
            <span>Value</span>
            <input
              type="password"
              value={typeof values[id] === "string" ? values[id] : ""}
              onChange={(event) => setValues((current) => ({ ...current, [id]: event.target.value }))}
              placeholder={placeholder}
              autoComplete="off"
            />
          </label>
          <div className="json-render-secret-meta">
            <code>
              {packageId || "package"}/{key || "key"}
            </code>
          </div>
          <button
            className="json-render-action"
            type="button"
            disabled={submittingAction === id || !(typeof values[id] === "string" && values[id])}
            onClick={() => void submitSecretInput(id, props)}
          >
            {submittingAction === id ? "Saving..." : submitLabel}
          </button>
          {renderChildren(element)}
        </section>
      );
    }

    return (
      <section className="json-render-card" key={id}>
        {title ? <h3>{title}</h3> : null}
        {description ? <p>{description}</p> : null}
        {renderChildren(element)}
      </section>
    );
  };

  return (
    <div className="json-render-shell">
      <div className="json-render-badge">json-render</div>
      {rootId ? renderElement(rootId) : <p>No root element in spec.</p>}
      {status ? <p className="json-render-status">{status}</p> : null}
    </div>
  );
}

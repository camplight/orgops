import { useEffect, useState } from "react";
import { apiJson } from "../api";
import { Button, Card, Input, Select } from "../components/ui";

type BillingGroup = {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  costUsdMicros: number;
};

type BillingUsageResponse = {
  groupBy: string;
  totals: BillingGroup;
  groups: BillingGroup[];
};

type BillingPrice = {
  id: string;
  provider: string;
  modelId: string;
  modelName: string;
  inputPricePerMillion: string;
  outputPricePerMillion: string;
  cachedInputPricePerMillion?: string | null;
  source: string;
  sourceUrl?: string | null;
  effectiveAt: number;
};

const numberFormatter = new Intl.NumberFormat();
const usdFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 6,
});
const PERIOD_PRESETS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "mtd", label: "Month to date" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom" },
];

function formatUsd(micros: number) {
  return usdFormatter.format((micros || 0) / 1_000_000);
}

function formatDate(ms: number) {
  if (!ms) return "-";
  return new Date(ms).toLocaleDateString();
}

function toDateTimeLocalValue(ms: number) {
  const date = new Date(ms);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value: string) {
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolvePeriod(
  preset: string,
  customSince: string,
  customUntil: string,
) {
  const now = Date.now();
  if (preset === "24h") return { since: now - 24 * 60 * 60 * 1000, until: now };
  if (preset === "7d") return { since: now - 7 * 24 * 60 * 60 * 1000, until: now };
  if (preset === "30d") return { since: now - 30 * 24 * 60 * 60 * 1000, until: now };
  if (preset === "mtd") {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return { since: start.getTime(), until: now };
  }
  if (preset === "custom") {
    return {
      since: fromDateTimeLocalValue(customSince),
      until: fromDateTimeLocalValue(customUntil),
    };
  }
  return {};
}

export function BillingScreen() {
  const [groupBy, setGroupBy] = useState("provider");
  const [periodPreset, setPeriodPreset] = useState("7d");
  const [customSince, setCustomSince] = useState(() =>
    toDateTimeLocalValue(Date.now() - 7 * 24 * 60 * 60 * 1000),
  );
  const [customUntil, setCustomUntil] = useState(() => toDateTimeLocalValue(Date.now()));
  const [usage, setUsage] = useState<BillingUsageResponse | null>(null);
  const [prices, setPrices] = useState<BillingPrice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (nextGroupBy = groupBy) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ groupBy: nextGroupBy });
      const period = resolvePeriod(periodPreset, customSince, customUntil);
      if (period.since) params.set("since", String(period.since));
      if (period.until) params.set("until", String(period.until));
      const [usageData, priceData] = await Promise.all([
        apiJson<BillingUsageResponse>(`/api/billing/usage?${params.toString()}`),
        apiJson<BillingPrice[]>("/api/billing/prices"),
      ]);
      setUsage(usageData);
      setPrices(priceData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh(groupBy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, periodPreset, customSince, customUntil]);

  const totals = usage?.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Billing</h1>
          <p className="text-sm text-slate-400">
            Estimated LLM spend from recorded provider token usage.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="space-y-1 text-xs text-slate-400">
            <span>Period</span>
            <Select
              value={periodPreset}
              onChange={(event) => setPeriodPreset(event.target.value)}
            >
              {PERIOD_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-xs text-slate-400">
            <span>Group by</span>
            <Select
              value={groupBy}
              onChange={(event) => setGroupBy(event.target.value)}
            >
              <option value="provider">Provider</option>
              <option value="model">Model</option>
              <option value="agent">Agent</option>
              <option value="channel">Channel</option>
            </Select>
          </label>
          <Button onClick={() => void refresh()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      {periodPreset === "custom" && (
        <Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-slate-400">
              <span>Start</span>
              <Input
                type="datetime-local"
                value={customSince}
                onChange={(event) => setCustomSince(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs text-slate-400">
              <span>End</span>
              <Input
                type="datetime-local"
                value={customUntil}
                onChange={(event) => setCustomUntil(event.target.value)}
              />
            </label>
          </div>
        </Card>
      )}

      {error && <Card className="text-sm text-rose-300">{error}</Card>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <div className="text-xs uppercase tracking-wide text-slate-400">Estimated cost</div>
          <div className="text-2xl font-semibold text-emerald-300">
            {formatUsd(totals?.costUsdMicros ?? 0)}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-slate-400">LLM calls</div>
          <div className="text-2xl font-semibold text-slate-100">
            {numberFormatter.format(totals?.calls ?? 0)}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-slate-400">Input tokens</div>
          <div className="text-2xl font-semibold text-cyan-300">
            {numberFormatter.format(totals?.inputTokens ?? 0)}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-slate-400">Output tokens</div>
          <div className="text-2xl font-semibold text-violet-300">
            {numberFormatter.format(totals?.outputTokens ?? 0)}
          </div>
        </Card>
      </div>

      <Card title={`Usage by ${groupBy}`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4">Key</th>
                <th className="py-2 pr-4">Cost</th>
                <th className="py-2 pr-4">Calls</th>
                <th className="py-2 pr-4">Input</th>
                <th className="py-2 pr-4">Cached</th>
                <th className="py-2 pr-4">Output</th>
                <th className="py-2 pr-4">Reasoning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {(usage?.groups ?? []).map((group) => (
                <tr key={group.key}>
                  <td className="py-2 pr-4 font-medium text-slate-100">{group.key}</td>
                  <td className="py-2 pr-4">{formatUsd(group.costUsdMicros)}</td>
                  <td className="py-2 pr-4">{numberFormatter.format(group.calls)}</td>
                  <td className="py-2 pr-4">{numberFormatter.format(group.inputTokens)}</td>
                  <td className="py-2 pr-4">{numberFormatter.format(group.cachedInputTokens)}</td>
                  <td className="py-2 pr-4">{numberFormatter.format(group.outputTokens)}</td>
                  <td className="py-2 pr-4">{numberFormatter.format(group.reasoningTokens)}</td>
                </tr>
              ))}
              {(usage?.groups ?? []).length === 0 && (
                <tr>
                  <td className="py-4 text-slate-500" colSpan={7}>
                    No LLM usage has been recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Known price snapshots">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4">Model</th>
                <th className="py-2 pr-4">Provider</th>
                <th className="py-2 pr-4">Input / 1M</th>
                <th className="py-2 pr-4">Cached / 1M</th>
                <th className="py-2 pr-4">Output / 1M</th>
                <th className="py-2 pr-4">Effective</th>
                <th className="py-2 pr-4">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {prices.map((price) => (
                <tr key={price.id}>
                  <td className="py-2 pr-4 font-medium text-slate-100">{price.modelId}</td>
                  <td className="py-2 pr-4">{price.provider}</td>
                  <td className="py-2 pr-4">${price.inputPricePerMillion}</td>
                  <td className="py-2 pr-4">
                    {price.cachedInputPricePerMillion ? `$${price.cachedInputPricePerMillion}` : "-"}
                  </td>
                  <td className="py-2 pr-4">${price.outputPricePerMillion}</td>
                  <td className="py-2 pr-4">{formatDate(price.effectiveAt)}</td>
                  <td className="py-2 pr-4">
                    {price.sourceUrl ? (
                      <a
                        className="text-cyan-300 hover:text-cyan-200"
                        href={price.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {price.source}
                      </a>
                    ) : (
                      price.source
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

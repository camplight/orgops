import { useEffect, useMemo, useState } from "react";
import { apiFetch, apiJson, getApiHeaders } from "../api";
import { Button, Card, Input, Select } from "../components/ui";
import type { Agent, Channel } from "../types";

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
  pricingTiers?: Array<{ minInputTokens: number }>;
  source: string;
  sourceUrl?: string | null;
  effectiveAt: number;
};

type PricingRefreshStartResponse = {
  refreshId: string;
  updaterAgentName: string;
};

type PricingRefreshStatusResponse = {
  refreshId: string;
  status: "RUNNING" | "COMPLETED";
  events: Array<{
    type: string;
    payload: {
      provider?: string;
      updatedModelIds?: string[];
      unresolved?: Array<{ modelId: string; reason: string }>;
      repriced?: number;
    };
  }>;
};

type SortDirection = "asc" | "desc";
type BillingGroupSortKey =
  | "key"
  | "costUsdMicros"
  | "calls"
  | "inputTokens"
  | "cachedInputTokens"
  | "outputTokens"
  | "reasoningTokens";
type BillingPriceSortKey =
  | "modelId"
  | "provider"
  | "inputPricePerMillion"
  | "cachedInputPricePerMillion"
  | "outputPricePerMillion"
  | "effectiveAt"
  | "source";

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
const BILLING_AUTO_REFRESH_MS = 30_000;
const BILLING_UPDATER_AGENT_STORAGE_KEY = "orgops.admin-ui.billingUpdaterAgent";
const SORT_BUTTON_CLASS = "text-left hover:text-slate-300";

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

function readStoredUpdaterAgentName() {
  try {
    return localStorage.getItem(BILLING_UPDATER_AGENT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredUpdaterAgentName(agentName: string) {
  try {
    if (agentName) {
      localStorage.setItem(BILLING_UPDATER_AGENT_STORAGE_KEY, agentName);
    } else {
      localStorage.removeItem(BILLING_UPDATER_AGENT_STORAGE_KEY);
    }
  } catch {
    // Cosmetic preference only.
  }
}

function sortDirectionFor<T extends string>(current: { key: T; direction: SortDirection }, key: T) {
  return current.key === key && current.direction === "asc" ? "desc" : "asc";
}

function sortIndicator<T extends string>(current: { key: T; direction: SortDirection }, key: T) {
  if (current.key !== key) return "";
  return current.direction === "asc" ? " ↑" : " ↓";
}

function compareStrings(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? "").localeCompare(right ?? "");
}

function compareNumbers(left: number | string | null | undefined, right: number | string | null | undefined) {
  return Number(left ?? 0) - Number(right ?? 0);
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
  const [channelId, setChannelId] = useState("");
  const [periodPreset, setPeriodPreset] = useState("7d");
  const [customSince, setCustomSince] = useState(() =>
    toDateTimeLocalValue(Date.now() - 7 * 24 * 60 * 60 * 1000),
  );
  const [customUntil, setCustomUntil] = useState(() => toDateTimeLocalValue(Date.now()));
  const [usage, setUsage] = useState<BillingUsageResponse | null>(null);
  const [prices, setPrices] = useState<BillingPrice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [updaterAgentName, setUpdaterAgentName] = useState(() => readStoredUpdaterAgentName());
  const [priceRefreshLoading, setPriceRefreshLoading] = useState(false);
  const [priceRefreshMessage, setPriceRefreshMessage] = useState<string | null>(null);
  const [priceRefreshUnresolved, setPriceRefreshUnresolved] = useState<
    Array<{ modelId: string; reason: string }>
  >([]);
  const [activeRefreshId, setActiveRefreshId] = useState<string | null>(null);
  const [updaterOpen, setUpdaterOpen] = useState(false);
  const [usageSort, setUsageSort] = useState<{ key: BillingGroupSortKey; direction: SortDirection }>({
    key: "costUsdMicros",
    direction: "desc",
  });
  const [priceSort, setPriceSort] = useState<{ key: BillingPriceSortKey; direction: SortDirection }>({
    key: "modelId",
    direction: "asc",
  });

  const refresh = async (nextGroupBy = groupBy, options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const params = new URLSearchParams({ groupBy: nextGroupBy });
      if (channelId) params.set("channelId", channelId);
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
      if (!options?.silent) setLoading(false);
    }
  };

  const updatePriceTable = async () => {
    setPriceRefreshLoading(true);
    setPriceRefreshMessage(null);
    setPriceRefreshUnresolved([]);
    setError(null);
    try {
      const response = await apiFetch("/api/billing/prices/refresh", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ updaterAgentName }),
      });
      const payload = (await response.json()) as PricingRefreshStartResponse;
      setActiveRefreshId(payload.refreshId);
      setPriceRefreshMessage(
        `${payload.updaterAgentName} is refreshing prices for models used by this OrgOps instance.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPriceRefreshLoading(false);
    }
  };

  useEffect(() => {
    void refresh(groupBy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, channelId, periodPreset, customSince, customUntil]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refresh(groupBy, { silent: true });
    }, BILLING_AUTO_REFRESH_MS);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, channelId, periodPreset, customSince, customUntil]);

  useEffect(() => {
    Promise.all([apiJson<Agent[]>("/api/agents"), apiJson<Channel[]>("/api/channels")])
      .then(([agentItems, channelItems]) => {
        setAgents(agentItems);
        setChannels(channelItems);
        setUpdaterAgentName((current) => {
          if (current && agentItems.some((agent) => agent.name === current)) return current;
          return agentItems.find((agent) => agent.agentRole === "SYSTEM")?.name ?? agentItems[0]?.name ?? "";
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    writeStoredUpdaterAgentName(updaterAgentName);
  }, [updaterAgentName]);

  useEffect(() => {
    if (!activeRefreshId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const status = await apiJson<PricingRefreshStatusResponse>(
          `/api/billing/prices/refresh/${encodeURIComponent(activeRefreshId)}`,
        );
        if (stopped) return;
        const providerEvents = status.events.filter(
          (event) => event.type === "billing.prices.refresh.provider.updated",
        );
        const updated = providerEvents.reduce(
          (count, event) => count + (event.payload.updatedModelIds?.length ?? 0),
          0,
        );
        const repriced = providerEvents.reduce(
          (count, event) => count + (event.payload.repriced ?? 0),
          0,
        );
        const completed = status.events.find(
          (event) => event.type === "billing.prices.refresh.completed",
        );
        if (completed || status.status === "COMPLETED") {
          const unresolved = completed?.payload.unresolved?.length ?? 0;
          setPriceRefreshUnresolved(completed?.payload.unresolved ?? []);
          setPriceRefreshMessage(
            `Refresh completed: ${numberFormatter.format(updated)} model prices updated, ${numberFormatter.format(
              repriced,
            )} usage rows priced, ${numberFormatter.format(unresolved)} unresolved.`,
          );
          setActiveRefreshId(null);
          await refresh(groupBy, { silent: true });
        } else {
          setPriceRefreshMessage(
            `Refresh running: ${numberFormatter.format(providerEvents.length)} providers reported, ${numberFormatter.format(updated)} model prices updated.`,
          );
        }
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 2_000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRefreshId]);

  const totals = usage?.totals;
  const updaterAgent = agents.find((agent) => agent.name === updaterAgentName);
  const sortedChannels = useMemo(
    () => [...channels].sort((left, right) => left.name.localeCompare(right.name)),
    [channels],
  );
  const sortedUsageGroups = useMemo(() => {
    const groups = [...(usage?.groups ?? [])];
    groups.sort((left, right) => {
      const result =
        usageSort.key === "key"
          ? compareStrings(left.key, right.key)
          : compareNumbers(left[usageSort.key], right[usageSort.key]);
      return usageSort.direction === "asc" ? result : -result;
    });
    return groups;
  }, [usage?.groups, usageSort]);
  const sortedPrices = useMemo(() => {
    const rows = [...prices];
    rows.sort((left, right) => {
      const result =
        priceSort.key === "modelId" || priceSort.key === "provider" || priceSort.key === "source"
          ? compareStrings(left[priceSort.key], right[priceSort.key])
          : compareNumbers(left[priceSort.key], right[priceSort.key]);
      return priceSort.direction === "asc" ? result : -result;
    });
    return rows;
  }, [priceSort, prices]);
  const changeUsageSort = (key: BillingGroupSortKey) => {
    setUsageSort((current) => ({ key, direction: sortDirectionFor(current, key) }));
  };
  const changePriceSort = (key: BillingPriceSortKey) => {
    setPriceSort((current) => ({ key, direction: sortDirectionFor(current, key) }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Billing</h1>
          <p className="text-sm text-slate-400">
            Estimated LLM spend from recorded provider token usage. Tables auto-refresh every 30 seconds.
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
          <label className="space-y-1 text-xs text-slate-400">
            <span>Channel</span>
            <Select
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
              className="min-w-48"
            >
              <option value="">All channels</option>
              {sortedChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
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
                <th className="py-2 pr-4">
                  <button type="button" className={SORT_BUTTON_CLASS} onClick={() => changeUsageSort("key")}>Key{sortIndicator(usageSort, "key")}</button>
                </th>
                <th className="py-2 pr-4">
                  <button type="button" className={SORT_BUTTON_CLASS} onClick={() => changeUsageSort("costUsdMicros")}>Cost{sortIndicator(usageSort, "costUsdMicros")}</button>
                </th>
                <th className="py-2 pr-4">
                  <button type="button" className={SORT_BUTTON_CLASS} onClick={() => changeUsageSort("calls")}>Calls{sortIndicator(usageSort, "calls")}</button>
                </th>
                <th className="py-2 pr-4">
                  <button type="button" className={SORT_BUTTON_CLASS} onClick={() => changeUsageSort("inputTokens")}>Input{sortIndicator(usageSort, "inputTokens")}</button>
                </th>
                <th className="py-2 pr-4">
                  <button type="button" className={SORT_BUTTON_CLASS} onClick={() => changeUsageSort("cachedInputTokens")}>Cached{sortIndicator(usageSort, "cachedInputTokens")}</button>
                </th>
                <th className="py-2 pr-4">
                  <button type="button" className={SORT_BUTTON_CLASS} onClick={() => changeUsageSort("outputTokens")}>Output{sortIndicator(usageSort, "outputTokens")}</button>
                </th>
                <th className="py-2 pr-4">
                  <button type="button" className={SORT_BUTTON_CLASS} onClick={() => changeUsageSort("reasoningTokens")}>Reasoning{sortIndicator(usageSort, "reasoningTokens")}</button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {sortedUsageGroups.map((group) => (
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
              {sortedUsageGroups.length === 0 && (
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

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-slate-100">Known price snapshots</h2>
          <Button
            onClick={() => void updatePriceTable()}
            disabled={priceRefreshLoading || Boolean(activeRefreshId) || !updaterAgentName}
          >
            {priceRefreshLoading || activeRefreshId ? "Updating..." : "Update table"}
          </Button>
        </div>
        <button
          type="button"
          className="flex items-center gap-2 text-left text-xs text-slate-400 hover:text-slate-300"
          aria-expanded={updaterOpen}
          onClick={() => setUpdaterOpen((open) => !open)}
        >
          <span>{updaterOpen ? "▾" : "▸"}</span>
          <span>
            Updater agent:{" "}
            {updaterAgent
              ? `${updaterAgent.name} (${updaterAgent.agentRole === "SYSTEM" ? "system" : "standard"})`
              : "none"}
          </span>
        </button>
        {updaterOpen ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="space-y-1 text-xs text-slate-400">
              <span>Updater agent</span>
              <Select
                value={updaterAgentName}
                onChange={(event) => setUpdaterAgentName(event.target.value)}
                className="min-w-56"
              >
                {agents.length === 0 ? <option value="">No agents available</option> : null}
                {agents.map((agent) => (
                  <option key={agent.name} value={agent.name}>
                    {agent.name}
                    {agent.agentRole === "SYSTEM" ? " (system)" : ""}
                  </option>
                ))}
              </Select>
            </label>
            <p className="text-xs text-slate-500 sm:pb-2">
              The first system agent is selected by default.
            </p>
          </div>
        ) : null}
        {priceRefreshMessage ? <p className="text-sm text-emerald-300">{priceRefreshMessage}</p> : null}
        {priceRefreshUnresolved.length > 0 ? (
          <ul className="space-y-1 text-xs text-amber-300">
            {priceRefreshUnresolved.map((item) => (
              <li key={item.modelId}>
                <span className="font-medium">{item.modelId}</span>: {item.reason}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4">
                  <button type="button" className={SORT_BUTTON_CLASS} onClick={() => changePriceSort("modelId")}>Model{sortIndicator(priceSort, "modelId")}</button>
                </th>
                <th className="py-2 pr-4">
                  <button type="button" className={SORT_BUTTON_CLASS} onClick={() => changePriceSort("provider")}>Provider{sortIndicator(priceSort, "provider")}</button>
                </th>
                <th className="py-2 pr-4">
                  <button type="button" className={SORT_BUTTON_CLASS} onClick={() => changePriceSort("inputPricePerMillion")}>Input / 1M{sortIndicator(priceSort, "inputPricePerMillion")}</button>
                </th>
                <th className="py-2 pr-4">
                  <button type="button" className={SORT_BUTTON_CLASS} onClick={() => changePriceSort("cachedInputPricePerMillion")}>Cached / 1M{sortIndicator(priceSort, "cachedInputPricePerMillion")}</button>
                </th>
                <th className="py-2 pr-4">
                  <button type="button" className={SORT_BUTTON_CLASS} onClick={() => changePriceSort("outputPricePerMillion")}>Output / 1M{sortIndicator(priceSort, "outputPricePerMillion")}</button>
                </th>
                <th className="py-2 pr-4">
                  <button type="button" className={SORT_BUTTON_CLASS} onClick={() => changePriceSort("effectiveAt")}>Effective{sortIndicator(priceSort, "effectiveAt")}</button>
                </th>
                <th className="py-2 pr-4">
                  <button type="button" className={SORT_BUTTON_CLASS} onClick={() => changePriceSort("source")}>Source{sortIndicator(priceSort, "source")}</button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {sortedPrices.map((price) => (
                <tr key={price.id}>
                  <td className="py-2 pr-4 font-medium text-slate-100">
                    <div>{price.modelId}</div>
                    {price.pricingTiers?.length ? (
                      <div className="text-xs font-normal text-slate-500">
                        {price.pricingTiers.length + 1} context tiers
                      </div>
                    ) : null}
                  </td>
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

import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import type { AccessControl, RequestUser } from "./access";

type BillingDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  access: AccessControl;
  requireAuth: (c: any, next: any) => Response | Promise<Response>;
  requireRunnerAuth: (c: any, next: any) => Response | Promise<Response>;
};

type PriceSnapshot = {
  id: string;
  provider: string;
  modelId: string;
  modelName: string;
  currency: string;
  inputPricePerMillion: string;
  outputPricePerMillion: string;
  cachedInputPricePerMillion?: string | null;
  reasoningPricePerMillion?: string | null;
  source: string;
  sourceUrl?: string | null;
  effectiveAt: number;
};

const USD = "USD";
const OPENAI_PRICING_URL = "https://developers.openai.com/api/docs/pricing";
const ANTHROPIC_PRICING_URL = "https://platform.claude.com/docs/en/about-claude/pricing";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

const CURATED_PRICES: Array<Omit<PriceSnapshot, "id" | "currency">> = [
  {
    provider: "openai",
    modelId: "openai:gpt-5.6-sol",
    modelName: "gpt-5.6-sol",
    inputPricePerMillion: "4.00",
    outputPricePerMillion: "20.00",
    cachedInputPricePerMillion: "0.40",
    source: "openai-docs",
    sourceUrl: OPENAI_PRICING_URL,
    effectiveAt: Date.UTC(2026, 9, 19),
  },
  {
    provider: "openai",
    modelId: "openai:gpt-5.6-terra",
    modelName: "gpt-5.6-terra",
    inputPricePerMillion: "2.00",
    outputPricePerMillion: "12.00",
    cachedInputPricePerMillion: "0.20",
    source: "openai-docs",
    sourceUrl: OPENAI_PRICING_URL,
    effectiveAt: Date.UTC(2026, 9, 19),
  },
  {
    provider: "openai",
    modelId: "openai:gpt-5.6-luna",
    modelName: "gpt-5.6-luna",
    inputPricePerMillion: "0.20",
    outputPricePerMillion: "1.20",
    cachedInputPricePerMillion: "0.02",
    source: "openai-docs",
    sourceUrl: OPENAI_PRICING_URL,
    effectiveAt: Date.UTC(2026, 9, 19),
  },
  {
    provider: "openai",
    modelId: "openai:gpt-5.2",
    modelName: "gpt-5.2",
    inputPricePerMillion: "1.75",
    outputPricePerMillion: "14.00",
    cachedInputPricePerMillion: "0.175",
    source: "openai-docs",
    sourceUrl: OPENAI_PRICING_URL,
    effectiveAt: Date.UTC(2026, 9, 19),
  },
  {
    provider: "openai",
    modelId: "openai:gpt-5",
    modelName: "gpt-5",
    inputPricePerMillion: "1.25",
    outputPricePerMillion: "10.00",
    cachedInputPricePerMillion: "0.125",
    source: "openai-docs",
    sourceUrl: OPENAI_PRICING_URL,
    effectiveAt: Date.UTC(2026, 9, 19),
  },
  {
    provider: "openai",
    modelId: "openai:gpt-4o-mini",
    modelName: "gpt-4o-mini",
    inputPricePerMillion: "0.15",
    outputPricePerMillion: "0.60",
    cachedInputPricePerMillion: "0.075",
    source: "openai-docs",
    sourceUrl: OPENAI_PRICING_URL,
    effectiveAt: Date.UTC(2026, 9, 19),
  },
  {
    provider: "anthropic",
    modelId: "anthropic:claude-opus-5-5",
    modelName: "claude-opus-5-5",
    inputPricePerMillion: "4.00",
    outputPricePerMillion: "20.00",
    cachedInputPricePerMillion: "0.20",
    source: "anthropic-docs",
    sourceUrl: ANTHROPIC_PRICING_URL,
    effectiveAt: Date.UTC(2026, 9, 7),
  },
  {
    provider: "anthropic",
    modelId: "anthropic:claude-sonnet-5-5",
    modelName: "claude-sonnet-5-5",
    inputPricePerMillion: "2.00",
    outputPricePerMillion: "10.00",
    cachedInputPricePerMillion: "0.10",
    source: "anthropic-docs",
    sourceUrl: ANTHROPIC_PRICING_URL,
    effectiveAt: Date.UTC(2026, 9, 7),
  },
  {
    provider: "anthropic",
    modelId: "anthropic:claude-haiku-5-5",
    modelName: "claude-haiku-5-5",
    inputPricePerMillion: "0.10",
    outputPricePerMillion: "0.50",
    cachedInputPricePerMillion: "0.01",
    source: "anthropic-docs",
    sourceUrl: ANTHROPIC_PRICING_URL,
    effectiveAt: Date.UTC(2026, 9, 7),
  },
  {
    provider: "anthropic",
    modelId: "anthropic:claude-3-5-sonnet-latest",
    modelName: "claude-3-5-sonnet-latest",
    inputPricePerMillion: "3.00",
    outputPricePerMillion: "15.00",
    cachedInputPricePerMillion: "0.30",
    source: "anthropic-docs",
    sourceUrl: ANTHROPIC_PRICING_URL,
    effectiveAt: Date.UTC(2026, 9, 7),
  },
];

const usageSchema = z.object({
  channelId: z.string().min(1).optional(),
  agentName: z.string().min(1).optional(),
  modelId: z.string().min(1),
  runtime: z.string().min(1).default("classic"),
  purpose: z.string().min(1).default("turn"),
  triggerEventId: z.string().min(1).optional(),
  usageSource: z.enum(["provider", "estimate"]).default("provider"),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function parseModelId(modelId: string) {
  const [rawProvider, ...parts] = modelId.split(":");
  const provider = (rawProvider || "unknown").trim().toLowerCase();
  const modelName = parts.join(":").trim() || modelId;
  return { provider, modelName };
}

function priceId(provider: string, modelId: string, effectiveAt: number) {
  return `${provider}:${modelId}:${effectiveAt}`;
}

function normalizePriceRow(row: any): PriceSnapshot {
  return {
    id: row.id,
    provider: row.provider,
    modelId: row.model_id,
    modelName: row.model_name,
    currency: row.currency,
    inputPricePerMillion: row.input_price_per_million,
    outputPricePerMillion: row.output_price_per_million,
    cachedInputPricePerMillion: row.cached_input_price_per_million,
    reasoningPricePerMillion: row.reasoning_price_per_million,
    source: row.source,
    sourceUrl: row.source_url,
    effectiveAt: row.effective_at,
  };
}

function numericPrice(value: string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function calculateCostUsdMicros(
  price: PriceSnapshot | null,
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
  },
) {
  if (!price) return 0;
  const billableInputTokens = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const dollars =
    (billableInputTokens * numericPrice(price.inputPricePerMillion)) / 1_000_000 +
    (usage.cachedInputTokens * numericPrice(price.cachedInputPricePerMillion)) / 1_000_000 +
    (usage.outputTokens * numericPrice(price.outputPricePerMillion)) / 1_000_000 +
    (usage.reasoningTokens * numericPrice(price.reasoningPricePerMillion)) / 1_000_000;
  return Math.max(0, Math.round(dollars * 1_000_000));
}

export function registerBillingRoutes(app: Hono<any>, deps: BillingDeps) {
  const { orm, jsonResponse, access, requireAuth, requireRunnerAuth } = deps;

  function seedCuratedPrices() {
    const now = Date.now();
    for (const price of CURATED_PRICES) {
      orm
        .insert(schema.llmModelPrices)
        .values({
          id: priceId(price.provider, price.modelId, price.effectiveAt),
          provider: price.provider,
          model_id: price.modelId,
          model_name: price.modelName,
          currency: USD,
          input_price_per_million: price.inputPricePerMillion,
          output_price_per_million: price.outputPricePerMillion,
          cached_input_price_per_million: price.cachedInputPricePerMillion ?? null,
          reasoning_price_per_million: price.reasoningPricePerMillion ?? null,
          source: price.source,
          source_url: price.sourceUrl ?? null,
          effective_at: price.effectiveAt,
          fetched_at: null,
          metadata_json: "{}",
          created_at: now,
        })
        .onConflictDoNothing()
        .run();
    }
  }

  function findPrice(modelId: string, createdAt: number): PriceSnapshot | null {
    const { provider } = parseModelId(modelId);
    const row = orm
      .select()
      .from(schema.llmModelPrices)
      .where(
        and(
          eq(schema.llmModelPrices.provider, provider),
          eq(schema.llmModelPrices.model_id, modelId),
          lte(schema.llmModelPrices.effective_at, createdAt),
        ),
      )
      .orderBy(desc(schema.llmModelPrices.effective_at))
      .limit(1)
      .get() as any | undefined;
    return row ? normalizePriceRow(row) : null;
  }

  seedCuratedPrices();

  app.get("/api/billing/prices", requireAuth, (c) => {
    const rows = orm
      .select()
      .from(schema.llmModelPrices)
      .orderBy(schema.llmModelPrices.provider, schema.llmModelPrices.model_id)
      .all() as any[];
    return jsonResponse(c, rows.map(normalizePriceRow));
  });

  app.post("/api/billing/prices/refresh/openrouter", requireAuth, async (c) => {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: {
        ...(process.env.OPENROUTER_API_KEY
          ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
          : {}),
      },
    });
    if (!response.ok) {
      return jsonResponse(c, { error: `OpenRouter model fetch failed: ${response.status}` }, 502);
    }
    const payload = (await response.json()) as {
      data?: Array<{
        id?: string;
        canonical_slug?: string;
        canonicalSlug?: string;
        name?: string;
        pricing?: {
          prompt?: string;
          completion?: string;
          input_cache_read?: string;
          internal_reasoning?: string;
        };
      }>;
    };
    const now = Date.now();
    let upserted = 0;
    for (const model of payload.data ?? []) {
      const slug = (model.canonical_slug || model.canonicalSlug || model.id || "").trim();
      const prompt = Number(model.pricing?.prompt);
      const completion = Number(model.pricing?.completion);
      if (!slug || !Number.isFinite(prompt) || !Number.isFinite(completion)) continue;
      const modelId = `openrouter:${slug}`;
      orm
        .insert(schema.llmModelPrices)
        .values({
          id: priceId("openrouter", modelId, now),
          provider: "openrouter",
          model_id: modelId,
          model_name: slug,
          currency: USD,
          input_price_per_million: String(prompt * 1_000_000),
          output_price_per_million: String(completion * 1_000_000),
          cached_input_price_per_million:
            model.pricing?.input_cache_read !== undefined
              ? String(Number(model.pricing.input_cache_read) * 1_000_000)
              : null,
          reasoning_price_per_million:
            model.pricing?.internal_reasoning !== undefined
              ? String(Number(model.pricing.internal_reasoning) * 1_000_000)
              : null,
          source: "openrouter-api",
          source_url: OPENROUTER_MODELS_URL,
          effective_at: now,
          fetched_at: now,
          metadata_json: JSON.stringify({ name: model.name ?? null }),
          created_at: now,
        })
        .onConflictDoNothing()
        .run();
      upserted += 1;
    }
    return jsonResponse(c, { upserted, fetchedAt: now });
  });

  app.post("/api/billing/usage", requireRunnerAuth, async (c) => {
    const user = (c as any).get("user") as RequestUser | undefined;
    if (user?.username !== "runner") {
      return jsonResponse(c, { error: "Runner token required" }, 401);
    }
    const body = await c.req.json();
    const parsed = usageSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse(c, { error: "Invalid usage payload", issues: parsed.error.issues }, 400);
    }
    if (parsed.data.channelId && !access.canViewChannel(user, parsed.data.channelId)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    const now = Date.now();
    const { provider, modelName } = parseModelId(parsed.data.modelId);
    const inputTokens = parsed.data.inputTokens ?? 0;
    const outputTokens = parsed.data.outputTokens ?? 0;
    const reasoningTokens = parsed.data.reasoningTokens ?? 0;
    const cachedInputTokens = parsed.data.cachedInputTokens ?? 0;
    const totalTokens =
      parsed.data.totalTokens ?? inputTokens + outputTokens + reasoningTokens;
    const price = findPrice(parsed.data.modelId, now);
    const costUsdMicros = calculateCostUsdMicros(price, {
      inputTokens,
      outputTokens,
      reasoningTokens,
      cachedInputTokens,
    });
    const id = randomUUID();
    orm
      .insert(schema.llmUsage)
      .values({
        id,
        created_at: now,
        channel_id: parsed.data.channelId ?? null,
        agent_name: parsed.data.agentName ?? null,
        provider,
        model_id: parsed.data.modelId,
        model_name: modelName,
        runtime: parsed.data.runtime,
        purpose: parsed.data.purpose,
        trigger_event_id: parsed.data.triggerEventId ?? null,
        usage_source: parsed.data.usageSource,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        reasoning_tokens: reasoningTokens,
        cached_input_tokens: cachedInputTokens,
        cost_usd_micros: costUsdMicros,
        price_snapshot_json: JSON.stringify(price ?? {}),
        metadata_json: JSON.stringify(parsed.data.metadata ?? {}),
      })
      .run();
    return jsonResponse(c, { id, costUsdMicros, priceFound: Boolean(price) }, 201);
  });

  app.get("/api/billing/usage", requireAuth, (c) => {
    const user = (c as any).get("user") as RequestUser | undefined;
    const url = new URL(c.req.url);
    const groupBy = url.searchParams.get("groupBy") ?? "provider";
    const since = Number(url.searchParams.get("since") ?? "");
    const until = Number(url.searchParams.get("until") ?? "");
    const clauses: any[] = [];
    if (Number.isFinite(since) && since > 0) clauses.push(gte(schema.llmUsage.created_at, since));
    if (Number.isFinite(until) && until > 0) clauses.push(lte(schema.llmUsage.created_at, until));
    const rows = orm
      .select()
      .from(schema.llmUsage)
      .where(clauses.length > 0 ? and(...clauses) : undefined)
      .orderBy(desc(schema.llmUsage.created_at))
      .all() as any[];
    const visibleRows = rows.filter((row) => {
      if (!row.channel_id) return true;
      return access.canViewChannel(user, row.channel_id);
    });
    const keyFor = (row: any) => {
      if (groupBy === "channel") return row.channel_id ?? "none";
      if (groupBy === "agent") return row.agent_name ?? "none";
      if (groupBy === "model") return row.model_id;
      return row.provider;
    };
    const groups = new Map<string, any>();
    for (const row of visibleRows) {
      const key = keyFor(row);
      const existing =
        groups.get(key) ??
        {
          key,
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          costUsdMicros: 0,
        };
      existing.calls += 1;
      existing.inputTokens += row.input_tokens ?? 0;
      existing.outputTokens += row.output_tokens ?? 0;
      existing.totalTokens += row.total_tokens ?? 0;
      existing.reasoningTokens += row.reasoning_tokens ?? 0;
      existing.cachedInputTokens += row.cached_input_tokens ?? 0;
      existing.costUsdMicros += row.cost_usd_micros ?? 0;
      groups.set(key, existing);
    }
    const totals = [...groups.values()].reduce(
      (acc, group) => {
        acc.calls += group.calls;
        acc.inputTokens += group.inputTokens;
        acc.outputTokens += group.outputTokens;
        acc.totalTokens += group.totalTokens;
        acc.reasoningTokens += group.reasoningTokens;
        acc.cachedInputTokens += group.cachedInputTokens;
        acc.costUsdMicros += group.costUsdMicros;
        return acc;
      },
      {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        costUsdMicros: 0,
      },
    );
    return jsonResponse(c, {
      groupBy,
      totals,
      groups: [...groups.values()].sort((a, b) => b.costUsdMicros - a.costUsdMicros),
    });
  });
}

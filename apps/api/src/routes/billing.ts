import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import providerPriceCatalog from "../provider-prices.json" with { type: "json" };
import type { AccessControl, RequestUser } from "./access";

type BillingDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  access: AccessControl;
  requireAuth: (c: any, next: any) => Response | Promise<Response>;
  requireRunnerAuth: (c: any, next: any) => Response | Promise<Response>;
};

type PriceTier = {
  minInputTokens: number;
  inputPricePerMillion: string;
  outputPricePerMillion: string;
  cachedInputPricePerMillion?: string | null;
  reasoningPricePerMillion?: string | null;
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
  pricingTiers?: PriceTier[];
};

const USD = "USD";

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

const priceTierSchema = z
  .object({
    minInputTokens: z.number().int().positive(),
    inputPricePerMillion: z.number().nonnegative(),
    outputPricePerMillion: z.number().nonnegative(),
    cachedInputPricePerMillion: z.number().nonnegative().nullable().optional(),
    reasoningPricePerMillion: z.number().nonnegative().nullable().optional(),
  })
  .strict();

const priceUpsertItemSchema = z
  .object({
    provider: z.string().trim().min(1).optional(),
    modelId: z.string().trim().min(1),
    modelName: z.string().trim().min(1).optional(),
    currency: z.string().trim().min(1).default(USD),
    inputPricePerMillion: z.number().nonnegative(),
    outputPricePerMillion: z.number().nonnegative(),
    cachedInputPricePerMillion: z.number().nonnegative().nullable().optional(),
    reasoningPricePerMillion: z.number().nonnegative().nullable().optional(),
    pricingTiers: z.array(priceTierSchema).optional(),
    source: z.string().trim().min(1).default("manual"),
    sourceUrl: z.string().trim().url().nullable().optional(),
    effectiveAt: z.number().int().positive().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const staticPriceCatalogSchema = z
  .object({
    prices: z.array(
      priceUpsertItemSchema.extend({
        source: z.string().trim().min(1),
        sourceUrl: z.string().trim().url(),
        effectiveAt: z
          .string()
          .datetime()
          .transform((value) => Date.parse(value)),
      }),
    ),
  })
  .strict();
const STATIC_PRICES = staticPriceCatalogSchema.parse(providerPriceCatalog).prices;

function parseModelId(modelId: string) {
  const [rawProvider, ...parts] = modelId.split(":");
  const provider = (rawProvider || "unknown").trim().toLowerCase();
  const modelName = parts.join(":").trim() || modelId;
  return { provider, modelName };
}

function priceId(provider: string, modelId: string, effectiveAt: number) {
  return `${provider}:${modelId}:${effectiveAt}`;
}

function parsePriceMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizePriceRow(row: any): PriceSnapshot {
  const metadata = parsePriceMetadata(row.metadata_json);
  const tiers = z.array(priceTierSchema).safeParse(metadata.pricingTiers);
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
    ...(tiers.success
      ? {
          pricingTiers: tiers.data.map((tier) => ({
            minInputTokens: tier.minInputTokens,
            inputPricePerMillion: String(tier.inputPricePerMillion),
            outputPricePerMillion: String(tier.outputPricePerMillion),
            cachedInputPricePerMillion:
              tier.cachedInputPricePerMillion == null
                ? null
                : String(tier.cachedInputPricePerMillion),
            reasoningPricePerMillion:
              tier.reasoningPricePerMillion == null
                ? null
                : String(tier.reasoningPricePerMillion),
          })),
        }
      : {}),
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
  const selectedTier = [...(price.pricingTiers ?? [])]
    .sort((a, b) => b.minInputTokens - a.minInputTokens)
    .find((tier) => usage.inputTokens >= tier.minInputTokens);
  const applicablePrice = selectedTier ?? price;
  const billableInputTokens = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const dollars =
    (billableInputTokens * numericPrice(applicablePrice.inputPricePerMillion)) / 1_000_000 +
    (usage.cachedInputTokens * numericPrice(applicablePrice.cachedInputPricePerMillion)) /
      1_000_000 +
    (usage.outputTokens * numericPrice(applicablePrice.outputPricePerMillion)) / 1_000_000 +
    (usage.reasoningTokens * numericPrice(applicablePrice.reasoningPricePerMillion)) / 1_000_000;
  return Math.max(0, Math.round(dollars * 1_000_000));
}

export function registerBillingRoutes(app: Hono<any>, deps: BillingDeps) {
  const {
    orm,
    jsonResponse,
    access,
    requireAuth,
    requireRunnerAuth,
  } = deps;

  function findPrice(
    modelId: string,
    createdAt: number,
    options?: { allowLaterSnapshot?: boolean },
  ): PriceSnapshot | null {
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
    if (row) return normalizePriceRow(row);
    if (!options?.allowLaterSnapshot) return null;
    const laterRow = orm
      .select()
      .from(schema.llmModelPrices)
      .where(
        and(
          eq(schema.llmModelPrices.provider, provider),
          eq(schema.llmModelPrices.model_id, modelId),
        ),
      )
      .orderBy(asc(schema.llmModelPrices.effective_at))
      .limit(1)
      .get() as any | undefined;
    return laterRow ? normalizePriceRow(laterRow) : null;
  }

  // Usage recorded before any price existed for its model keeps an empty
  // snapshot; those rows are priced once a snapshot appears. Priced rows are
  // never touched so historical totals stay reproducible.
  function repriceUnpricedUsage() {
    const rows = orm
      .select()
      .from(schema.llmUsage)
      .where(eq(schema.llmUsage.price_snapshot_json, "{}"))
      .all() as any[];
    let repriced = 0;
    for (const row of rows) {
      const price = findPrice(row.model_id, row.created_at, { allowLaterSnapshot: true });
      if (!price) continue;
      const costUsdMicros = calculateCostUsdMicros(price, {
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        reasoningTokens: row.reasoning_tokens ?? 0,
        cachedInputTokens: row.cached_input_tokens ?? 0,
      });
      orm
        .update(schema.llmUsage)
        .set({ cost_usd_micros: costUsdMicros, price_snapshot_json: JSON.stringify(price) })
        .where(eq(schema.llmUsage.id, row.id))
        .run();
      repriced += 1;
    }
    return repriced;
  }

  function upsertPrice(
    item: z.infer<typeof priceUpsertItemSchema>,
    now = Date.now(),
    fetchedAt: number | null = null,
  ) {
    const parsedModel = parseModelId(item.modelId);
    const provider = (item.provider ?? parsedModel.provider).trim().toLowerCase();
    if (provider !== parsedModel.provider) {
      throw new Error("provider must match modelId prefix");
    }
    const effectiveAt = item.effectiveAt ?? now;
    const metadata = {
      ...(item.metadata ?? {}),
      ...(item.pricingTiers?.length ? { pricingTiers: item.pricingTiers } : {}),
    };
    orm
      .insert(schema.llmModelPrices)
      .values({
        id: priceId(provider, item.modelId, effectiveAt),
        provider,
        model_id: item.modelId,
        model_name: item.modelName ?? parsedModel.modelName,
        currency: item.currency.toUpperCase(),
        input_price_per_million: String(item.inputPricePerMillion),
        output_price_per_million: String(item.outputPricePerMillion),
        cached_input_price_per_million:
          item.cachedInputPricePerMillion == null
            ? null
            : String(item.cachedInputPricePerMillion),
        reasoning_price_per_million:
          item.reasoningPricePerMillion == null
            ? null
            : String(item.reasoningPricePerMillion),
        source: item.source,
        source_url: item.sourceUrl ?? null,
        effective_at: effectiveAt,
        fetched_at: fetchedAt,
        metadata_json: JSON.stringify(metadata),
        created_at: now,
      })
      .onConflictDoUpdate({
        target: schema.llmModelPrices.id,
        set: {
          model_name: item.modelName ?? parsedModel.modelName,
          currency: item.currency.toUpperCase(),
          input_price_per_million: String(item.inputPricePerMillion),
          output_price_per_million: String(item.outputPricePerMillion),
          cached_input_price_per_million:
            item.cachedInputPricePerMillion == null
              ? null
              : String(item.cachedInputPricePerMillion),
          reasoning_price_per_million:
            item.reasoningPricePerMillion == null
              ? null
              : String(item.reasoningPricePerMillion),
          source: item.source,
          source_url: item.sourceUrl ?? null,
          fetched_at: fetchedAt,
          metadata_json: JSON.stringify(metadata),
        },
      })
      .run();
  }

  const catalogKeys = new Set<string>();
  for (const price of STATIC_PRICES) {
    const parsedModel = parseModelId(price.modelId);
    const provider = (price.provider ?? parsedModel.provider).trim().toLowerCase();
    if (provider !== parsedModel.provider) {
      throw new Error(`Catalog provider does not match model ID ${price.modelId}`);
    }
    const key = priceId(provider, price.modelId, price.effectiveAt);
    if (catalogKeys.has(key)) throw new Error(`Duplicate provider price catalog row ${key}`);
    catalogKeys.add(key);
  }
  orm.delete(schema.llmModelPrices).run();
  const seededAt = Date.now();
  for (const price of STATIC_PRICES) upsertPrice(price, seededAt);
  repriceUnpricedUsage();

  app.get("/api/billing/prices", requireAuth, (c) => {
    const rows = orm
      .select()
      .from(schema.llmModelPrices)
      .orderBy(schema.llmModelPrices.provider, schema.llmModelPrices.model_id)
      .all() as any[];
    return jsonResponse(c, rows.map(normalizePriceRow));
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
    const channelId = url.searchParams.get("channelId")?.trim();
    const since = Number(url.searchParams.get("since") ?? "");
    const until = Number(url.searchParams.get("until") ?? "");
    const clauses: any[] = [];
    if (channelId) {
      if (!access.canViewChannel(user, channelId)) {
        return jsonResponse(c, { error: "Forbidden" }, 403);
      }
      clauses.push(eq(schema.llmUsage.channel_id, channelId));
    }
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

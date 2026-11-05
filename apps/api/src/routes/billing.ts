import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import type { AccessControl, RequestUser } from "./access";

type BillingDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  access: AccessControl;
  requireAuth: (c: any, next: any) => Response | Promise<Response>;
  requireRunnerAuth: (c: any, next: any) => Response | Promise<Response>;
  insertEvent: (input: any) => any;
  registerEventObserver: (observer: (input: any, row: any) => void) => void;
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
const PROVIDER_PRICING_SOURCES: Record<string, string[]> = {
  openai: [OPENAI_PRICING_URL, "https://developers.openai.com/api/docs/models"],
  anthropic: [ANTHROPIC_PRICING_URL, "https://platform.claude.com/docs/en/models/overview"],
  mistral: ["https://docs.mistral.ai/inference/pricing", "https://docs.mistral.ai/models"],
  liquid: ["https://www.liquid.ai/pricing", "https://docs.liquid.ai/api/models"],
  openrouter: [OPENROUTER_MODELS_URL],
};

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
    source: z.string().trim().min(1).default("manual"),
    sourceUrl: z.string().trim().url().nullable().optional(),
    effectiveAt: z.number().int().positive().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const priceUpsertSchema = z.union([
  priceUpsertItemSchema,
  z.object({ prices: z.array(priceUpsertItemSchema).min(1) }).strict(),
]);

const refreshStartSchema = z
  .object({ updaterAgentName: z.string().trim().min(1) })
  .strict();

const refreshAgentResponseSchema = z
  .object({
    prices: z.array(priceUpsertItemSchema).default([]),
    unresolved: z
      .array(
        z.object({
          modelId: z.string().trim().min(1),
          reason: z.string().trim().min(1),
        }),
      )
      .default([]),
  })
  .strict();

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
  const {
    orm,
    jsonResponse,
    access,
    requireAuth,
    requireRunnerAuth,
    insertEvent,
    registerEventObserver,
  } = deps;

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
        metadata_json: JSON.stringify(item.metadata ?? {}),
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
          metadata_json: JSON.stringify(item.metadata ?? {}),
        },
      })
      .run();
  }

  function findRefreshRequest(refreshId: string) {
    const rows = orm
      .select()
      .from(schema.events)
      .where(eq(schema.events.type, "billing.prices.refresh.requested"))
      .orderBy(desc(schema.events.created_at))
      .all() as any[];
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload_json);
        if (payload.refreshId === refreshId) return { row, payload };
      } catch {}
    }
    return null;
  }

  function refreshEvents(refreshId: string) {
    return (orm
      .select()
      .from(schema.events)
      .where(
        inArray(schema.events.type, [
          "billing.prices.refresh.requested",
          "billing.prices.refresh.provider.updated",
          "billing.prices.refresh.completed",
        ]),
      )
      .orderBy(asc(schema.events.created_at))
      .all() as any[])
      .filter((row) => row.type.startsWith("billing.prices.refresh."))
      .flatMap((row) => {
        try {
          const payload = JSON.parse(row.payload_json);
          return payload.refreshId === refreshId
            ? [{ id: row.id, type: row.type, createdAt: row.created_at, payload }]
            : [];
        } catch {
          return [];
        }
      });
  }

  function parseAgentPriceResponse(text: string) {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed;
    return refreshAgentResponseSchema.safeParse(JSON.parse(fenced));
  }

  function archiveRefreshChannel(channelId: string | null | undefined) {
    if (!channelId) return;
    orm
      .update(schema.channels)
      .set({ archived_at: Date.now() })
      .where(eq(schema.channels.id, channelId))
      .run();
  }

  function completeRefreshWithFailure(request: any, reason: string) {
    const requestedModelIds = Object.values(request.payload.modelsByProvider ?? {}).flat() as string[];
    insertEvent({
      type: "billing.prices.refresh.completed",
      source: "system:billing",
      channelId: request.row.channel_id,
      parentEventId: request.row.id,
      payload: {
        refreshId: request.payload.refreshId,
        unresolved: requestedModelIds.map((modelId) => ({ modelId, reason })),
      },
    });
    archiveRefreshChannel(request.row.channel_id);
  }

  registerEventObserver((input, row) => {
    if (
      input.type !== "message.created" ||
      typeof input.parentEventId !== "string" ||
      typeof input.source !== "string" ||
      !input.source.startsWith("agent:")
    ) {
      return;
    }
    const requestRow = orm
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, input.parentEventId))
      .get() as any | undefined;
    if (!requestRow || requestRow.type !== "billing.prices.refresh.requested") return;
    let requestPayload: any;
    try {
      requestPayload = JSON.parse(requestRow.payload_json);
    } catch {
      return;
    }
    const request = { row: requestRow, payload: requestPayload };
    if (input.source !== `agent:${requestPayload.targetAgentName}`) return;
    if (
      refreshEvents(requestPayload.refreshId).some(
        (event) => event.type === "billing.prices.refresh.completed",
      )
    ) {
      return;
    }

    const text = input.payload?.text;
    if (typeof text !== "string") {
      completeRefreshWithFailure(request, "Selected agent returned no JSON price table.");
      return;
    }
    let parsed: ReturnType<typeof parseAgentPriceResponse>;
    try {
      parsed = parseAgentPriceResponse(text);
    } catch {
      completeRefreshWithFailure(request, "Selected agent returned invalid JSON.");
      return;
    }
    if (!parsed.success) {
      completeRefreshWithFailure(request, "Selected agent returned an invalid price-table schema.");
      return;
    }

    const requestedModelIds = new Set<string>(
      Object.values(requestPayload.modelsByProvider ?? {}).flat() as string[],
    );
    for (const price of parsed.data.prices) {
      if (!requestedModelIds.has(price.modelId)) {
        completeRefreshWithFailure(request, `Agent proposed unrequested model ${price.modelId}.`);
        return;
      }
      if (!price.sourceUrl || new URL(price.sourceUrl).protocol !== "https:") {
        completeRefreshWithFailure(request, `Model ${price.modelId} lacks an HTTPS source URL.`);
        return;
      }
    }
    for (const unresolved of parsed.data.unresolved) {
      if (!requestedModelIds.has(unresolved.modelId)) {
        completeRefreshWithFailure(
          request,
          `Agent reported unrequested model ${unresolved.modelId}.`,
        );
        return;
      }
    }

    const now = Date.now();
    for (const price of parsed.data.prices) upsertPrice(price, now, now);
    const repriced = repriceUnpricedUsage();
    const pricesByProvider = new Map<string, string[]>();
    for (const price of parsed.data.prices) {
      const { provider } = parseModelId(price.modelId);
      const ids = pricesByProvider.get(provider) ?? [];
      ids.push(price.modelId);
      pricesByProvider.set(provider, ids);
    }
    const requestedProviders = Object.keys(requestPayload.modelsByProvider ?? {});
    for (const [providerIndex, provider] of requestedProviders.entries()) {
      insertEvent({
        type: "billing.prices.refresh.provider.updated",
        source: `agent:${requestPayload.targetAgentName}`,
        channelId: requestRow.channel_id,
        parentEventId: requestRow.id,
        payload: {
          refreshId: requestPayload.refreshId,
          provider,
          updatedModelIds: pricesByProvider.get(provider) ?? [],
          unresolved: parsed.data.unresolved.filter(
            (item) => parseModelId(item.modelId).provider === provider,
          ),
          repriced: providerIndex === 0 ? repriced : 0,
        },
      });
    }
    insertEvent({
      type: "billing.prices.refresh.completed",
      source: "system:billing",
      channelId: requestRow.channel_id,
      parentEventId: requestRow.id,
      payload: {
        refreshId: requestPayload.refreshId,
        unresolved: parsed.data.unresolved,
      },
    });
    archiveRefreshChannel(requestRow.channel_id);
  });

  seedCuratedPrices();

  app.get("/api/billing/prices", requireAuth, (c) => {
    const rows = orm
      .select()
      .from(schema.llmModelPrices)
      .orderBy(schema.llmModelPrices.provider, schema.llmModelPrices.model_id)
      .all() as any[];
    return jsonResponse(c, rows.map(normalizePriceRow));
  });

  app.post("/api/billing/prices", requireAuth, async (c) => {
    const body = await c.req.json();
    const parsed = priceUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse(c, { error: "Invalid pricing payload", issues: parsed.error.issues }, 400);
    }
    const items = "prices" in parsed.data ? parsed.data.prices : [parsed.data];
    let upserted = 0;
    for (const item of items) {
      try {
        upsertPrice(item);
      } catch (error) {
        return jsonResponse(
          c,
          {
            error: "Invalid pricing payload",
            issues: [{ path: ["provider"], message: String(error) }],
          },
          400,
        );
      }
      upserted += 1;
    }
    const repriced = repriceUnpricedUsage();
    return jsonResponse(c, { upserted, repriced }, 201);
  });

  app.post("/api/billing/prices/refresh/openrouter", requireAuth, async (c) => {
    let body: { updaterAgentName?: unknown } = {};
    try {
      body = (await c.req.json()) as { updaterAgentName?: unknown };
    } catch {
      body = {};
    }
    const requestedUpdaterAgentName =
      typeof body.updaterAgentName === "string" ? body.updaterAgentName.trim() : "";
    const updaterAgents = orm
      .select({ name: schema.agents.name, agentRole: schema.agents.agent_role })
      .from(schema.agents)
      .all();
    if (
      requestedUpdaterAgentName &&
      !updaterAgents.some((agent) => agent.name === requestedUpdaterAgentName)
    ) {
      return jsonResponse(c, { error: "Updater agent not found" }, 400);
    }
    const updaterAgentName =
      requestedUpdaterAgentName ||
      updaterAgents.find((agent) => agent.agentRole === "SYSTEM")?.name ||
      updaterAgents[0]?.name ||
      null;

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
      const prompt = Number(model.pricing?.prompt);
      const completion = Number(model.pricing?.completion);
      if (!Number.isFinite(prompt) || !Number.isFinite(completion)) continue;
      // Agents call models by `id`; the canonical slug is a dated alias of it.
      const slugs = [
        ...new Set(
          [model.id, model.canonical_slug, model.canonicalSlug]
            .map((value) => value?.trim() ?? "")
            .filter(Boolean),
        ),
      ];
      for (const slug of slugs) {
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
    }
    const repriced = repriceUnpricedUsage();
    return jsonResponse(c, { upserted, repriced, fetchedAt: now, updaterAgentName });
  });

  app.post("/api/billing/prices/refresh", requireAuth, async (c) => {
    const parsed = refreshStartSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return jsonResponse(c, { error: "Invalid refresh request", issues: parsed.error.issues }, 400);
    }
    const agent = orm
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.name, parsed.data.updaterAgentName))
      .get() as any | undefined;
    if (!agent) {
      return jsonResponse(c, { error: "Selected agent was not found" }, 400);
    }
    if (agent.desired_state !== "RUNNING" || !agent.assigned_runner_id) {
      return jsonResponse(c, { error: "Selected agent is not assigned and running" }, 409);
    }
    const modelIds = new Set<string>();
    for (const row of orm.select({ modelId: schema.agents.model_id }).from(schema.agents).all()) {
      if (row.modelId) modelIds.add(row.modelId);
    }
    for (const row of orm.select({ modelId: schema.llmUsage.model_id }).from(schema.llmUsage).all()) {
      if (row.modelId) modelIds.add(row.modelId);
    }
    for (const row of orm.select().from(schema.models).all() as any[]) {
      if (row.provider && row.model_name) modelIds.add(`${row.provider}:${row.model_name}`);
    }
    const modelsByProvider: Record<string, string[]> = {};
    for (const modelId of [...modelIds].sort()) {
      const { provider } = parseModelId(modelId);
      (modelsByProvider[provider] ??= []).push(modelId);
    }
    const refreshId = randomUUID();
    const refreshChannelId = randomUUID();
    orm
      .insert(schema.channels)
      .values({
        id: refreshChannelId,
        name: `agent.billing-refresh.${agent.name}.${refreshId}`,
        description: `Internal billing price refresh for ${agent.name}`,
        metadata_json: JSON.stringify({
          internal: true,
          purpose: "billing-price-refresh",
          refreshId,
          agentName: agent.name,
        }),
        visibility: "PRIVATE",
        owner_human_id: null,
        kind: "GROUP",
        direct_participant_key: null,
        created_at: Date.now(),
        archived_at: null,
      })
      .run();
    orm
      .insert(schema.channelSubscriptions)
      .values({
        channel_id: refreshChannelId,
        subscriber_type: "AGENT",
        subscriber_id: agent.name,
      })
      .run();
    const payload = {
      refreshId,
      targetAgentName: agent.name,
      modelsByProvider,
      sources: Object.fromEntries(
        Object.keys(modelsByProvider).map((provider) => [
          provider,
          PROVIDER_PRICING_SOURCES[provider] ?? [],
        ]),
      ),
      instructions:
        "Research authoritative current standard text-token prices for every exact model ID listed in modelsByProvider, using the supplied source URLs or other authoritative provider sources. Never guess. Return only one JSON object matching responseContract; do not call OrgOps billing APIs or emit a custom event. Put unverifiable, non-token, private-contract, modality-tiered, or ambiguous aliases in unresolved.",
      responseContract: {
        prices: [{
          modelId: "provider:exact-model-id",
          inputPricePerMillion: 0,
          outputPricePerMillion: 0,
          cachedInputPricePerMillion: null,
          reasoningPricePerMillion: null,
          source: "provider-docs",
          sourceUrl: "https://authoritative.example/pricing",
        }],
        unresolved: [{ modelId: "provider:exact-model-id", reason: "Why it cannot be priced safely" }],
      },
    };
    const event = insertEvent({
      type: "billing.prices.refresh.requested",
      source: "system:billing",
      channelId: refreshChannelId,
      payload,
      idempotencyKey: `billing-price-refresh:${refreshId}`,
    });
    return jsonResponse(
      c,
      {
        refreshId,
        eventId: event.id,
        updaterAgentName: agent.name,
        modelsByProvider,
      },
      202,
    );
  });

  app.get("/api/billing/prices/refresh/:refreshId", requireAuth, (c) => {
    const refreshId = c.req.param("refreshId");
    const request = findRefreshRequest(refreshId);
    if (!request) return jsonResponse(c, { error: "Refresh not found" }, 404);
    const events = refreshEvents(refreshId);
    const completed = events.find((event) => event.type === "billing.prices.refresh.completed");
    return jsonResponse(c, {
      refreshId,
      status: completed ? "COMPLETED" : "RUNNING",
      updaterAgentName: request.payload.targetAgentName,
      modelsByProvider: request.payload.modelsByProvider,
      events,
    });
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

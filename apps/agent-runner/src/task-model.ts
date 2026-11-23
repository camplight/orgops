import { TaskModelSchema, type TaskModel } from "@orgops/schemas";
import type { Agent, Event } from "./types";

export function taskModelRequest(agent: Agent, event: Event): TaskModel | undefined {
  if (event.type !== "message.created" || !event.source.startsWith("human:")) return;
  const result = TaskModelSchema.safeParse((event.payload as any)?.taskModel);
  if (result.success && result.data.agentName === agent.name) return result.data;
}

/** Each override is its own task; ordinary messages retain the existing burst batching. */
export function firstTaskBatch(agent: Agent, events: Event[]): Event[] {
  const boundary = events.findIndex(event => taskModelRequest(agent, event));
  return boundary < 0 ? events : events.slice(0, boundary === 0 ? 1 : boundary);
}

export type Candidate = {
  id: string; intelligence: number | null; price: number | null;
  vision: boolean; tools: boolean; context: number;
};

export function paretoFrontier(models: Candidate[]): Candidate[] {
  return models.filter(model => model.price !== null && model.intelligence !== null)
    .filter(model => !models.some(other => other.price !== null && other.intelligence !== null &&
      other.price <= model.price! && other.intelligence >= model.intelligence! &&
      (other.price < model.price! || other.intelligence > model.intelligence!)));
}

export function chooseTaskModel(request: TaskModel, models: Candidate[], vision: boolean): Candidate {
  const capable = models.filter(model => model.tools && (!vision || model.vision) &&
    model.context >= (request.mode === "economy" ? request.minContextTokens : 4096));
  if (request.mode === "manual") {
    const selected = capable.find(model => `openrouter:${model.id}` === request.modelId);
    if (!selected) throw Error("Requested model is unavailable or lacks required image/tool/context capabilities.");
    return selected;
  }
  const frontier = paretoFrontier(capable).filter(model =>
    model.intelligence! >= request.minIntelligence && model.price! <= request.maxPricePerMillion);
  frontier.sort((a, b) => a.price! - b.price! || b.intelligence! - a.intelligence! || a.id.localeCompare(b.id));
  if (!frontier[0]) throw Error("No capable benchmarked model meets this task's intelligence and price limits.");
  return frontier[0];
}

export function normalizeCandidates(catalog: any, benchmarks: any): Candidate[] {
  if (!Array.isArray(catalog?.data)) throw Error("Model catalog unavailable.");
  const scores = new Map<string, number>();
  const ambiguous = new Set<string>();
  for (const row of Array.isArray(benchmarks?.data) ? benchmarks.data : []) {
    if (row.source !== "artificial-analysis" || typeof row.model_permaslug !== "string" ||
        typeof row.intelligence_index !== "number" || !Number.isFinite(row.intelligence_index) ||
        row.intelligence_index < 0 || row.intelligence_index > 100) continue;
    if (scores.has(row.model_permaslug) && scores.get(row.model_permaslug) !== row.intelligence_index)
      ambiguous.add(row.model_permaslug);
    scores.set(row.model_permaslug, row.intelligence_index);
  }
  const price = (value: unknown): number | null => {
    if (typeof value !== "string" || !value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  return catalog.data.flatMap((row: any) => {
    if (typeof row?.id !== "string" || !/^[-\w.]+\/[-\w.]+$/.test(row.id) ||
        !row.architecture?.output_modalities?.includes("text")) return [];
    const input = price(row.pricing?.prompt), output = price(row.pricing?.completion);
    const key = row.canonical_slug ?? row.id;
    return [{
      id: row.id, intelligence: ambiguous.has(key) ? null : scores.get(key) ?? null,
      // Explicit 3:1 input/output estimate, not a total task budget.
      price: input === null || output === null ? null : (3 * input + output) * 250_000,
      vision: row.architecture?.input_modalities?.includes("image") === true,
      tools: row.supported_parameters?.includes("tools") === true,
      context: Number.isSafeInteger(row.context_length) ? row.context_length : 0,
    }];
  });
}

export async function resolveTaskModel(
  agent: Agent, event: Event, env: Record<string, string>, transport: typeof fetch = fetch,
): Promise<{ agent: Agent; selected: Candidate }> {
  const request = taskModelRequest(agent, event);
  if (!request || agent.mode === "WRAPPED" || agent.mode === "RLM_REPL")
    throw Error("Task model overrides require a CLASSIC agent and an explicit human task.");
  const key = env.OPENROUTER_API_KEY;
  if (!key) throw Error("OpenRouter credentials unavailable for this agent.");
  const read = async (path: string) => {
    const response = await transport(`https://openrouter.ai/api/v1/${path}`, {
      headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Error("OpenRouter routing data unavailable; saved model was not changed.");
    return response.json();
  };
  const [catalog, benchmarks] = await Promise.all([
    read("models"), request.mode === "economy"
      ? read("benchmarks?source=artificial-analysis&task_type=intelligence") : Promise.resolve(null),
  ]);
  const attachments = (event.payload as any)?.attachments;
  const vision = Array.isArray(attachments) && attachments.some(item =>
    typeof item?.mime === "string" && item.mime.startsWith("image/"));
  const selected = chooseTaskModel(request, normalizeCandidates(catalog, benchmarks), vision);
  return { selected, agent: { ...agent, modelId: `openrouter:${selected.id}`,
    openaiCompatibleReasoningEffort: null,
    modelCapabilities: { textInput: true, textOutput: true, toolCalling: true,
      imageInput: selected.vision, contextWindowTokens: selected.context },
  } };
}

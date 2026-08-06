import type { ClassificationResult } from "./types";

/**
 * Shape of the existing `generate()` LLM abstraction (`@orgops/llm`, already used by
 * turn-executor.ts) as injected here — the Classifier is the only LLM-backed piece in this
 * module (per brief.md "Component Architecture" -> "Classifier"). Injected rather than imported
 * directly so acceptance tests can supply a fake (Strategy B: the LLM call is a costly external
 * dependency, faked at the acceptance-test level — see distill/wave-decisions.md DWD-01),
 * mirroring apps/agent-runner/src/nwave-invocation/restatement-composer.ts's GenerateFn exactly.
 */
export type GenerateFn = (
  modelId: string,
  messages: Array<{ role: string; content: string }>,
  options?: Record<string, unknown>,
) => Promise<{ text: string }>;

export type ClassifierDependencies = {
  generate: GenerateFn;
  modelId: string;
};

export type TicketContentInput = {
  ticketTitle: string;
  ticketDescription: string | null;
  isLowDetail: boolean;
};

export type ClassificationDecision = {
  result: ClassificationResult;
  rationale: string;
};

const VALID_RESULTS: readonly ClassificationResult[] = [
  "DEVELOPMENT_WORK",
  "NOT_DEVELOPMENT_WORK",
  "LOW_CONFIDENCE",
];

const CLASSIFICATION_SYSTEM_PROMPT =
  "You classify a submitted ticket as one of DEVELOPMENT_WORK, NOT_DEVELOPMENT_WORK, or " +
  "LOW_CONFIDENCE (use LOW_CONFIDENCE whenever the ticket is genuinely ambiguous — never guess " +
  "between the other two). Respond with a single JSON object only: " +
  '{"result": "<one of the three values above>", "rationale": "<one plain-language sentence>"}.';

function buildClassificationUserPrompt(input: TicketContentInput): string {
  const detailNote = input.isLowDetail ? " (flagged as low-detail: description is blank/minimal)" : "";
  return `Title: "${input.ticketTitle}"\nDescription: ${input.ticketDescription ?? "(none)"}${detailNote}`;
}

function isValidResult(value: unknown): value is ClassificationResult {
  return typeof value === "string" && (VALID_RESULTS as readonly string[]).includes(value);
}

/**
 * Parses the LLM's raw text response into a validated `ClassificationDecision`. Per brief.md's
 * Failure/Timeout Handling table: "Classifier returns an unparseable or out-of-enum response ...
 * treated identically to an LLM error — surfaced as CLASSIFICATION_FAILED, never silently
 * coerced into one of the three valid result values." Thrown here (not returned as a union),
 * so the Classification Orchestrator's single catch block handles both a rejected generate()
 * call and an unparseable response identically, without a second branch.
 */
export function parseClassificationResponse(rawText: string): ClassificationDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Classifier response was not valid JSON: ${rawText}`);
  }
  const candidate = parsed as { result?: unknown; rationale?: unknown };
  if (!isValidResult(candidate.result)) {
    throw new Error(`Classifier response had an out-of-enum result: ${JSON.stringify(parsed)}`);
  }
  const rationale = typeof candidate.rationale === "string" ? candidate.rationale.trim() : "";
  if (!rationale) {
    throw new Error(`Classifier response had no rationale: ${JSON.stringify(parsed)}`);
  }
  return { result: candidate.result, rationale };
}

/**
 * Given ticket content, returns a classification decision (US-02's three-value output space).
 * Prompt content and confidence-thresholding logic are software-crafter's implementation
 * decision during GREEN — this module specifies the interface contract and response-parsing
 * discipline, not the classification algorithm (brief.md "Classifier").
 */
export async function classifyTicketContent(
  input: TicketContentInput,
  deps: ClassifierDependencies,
): Promise<ClassificationDecision> {
  const generated = await deps.generate(deps.modelId, [
    { role: "system", content: CLASSIFICATION_SYSTEM_PROMPT },
    { role: "user", content: buildClassificationUserPrompt(input) },
  ]);
  return parseClassificationResponse(generated.text.trim());
}

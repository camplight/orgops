export const __SCAFFOLD__ = true;

/**
 * Shape of the existing `generate()` LLM abstraction (`@orgops/llm`, already used by
 * turn-executor.ts) as injected here — the Restatement Composer is the only LLM-backed piece
 * in this module (per brief.md "Component Architecture" item 1). Injected rather than imported
 * directly so acceptance tests can supply a fake (Strategy B: the LLM call is a costly external
 * dependency, faked at the acceptance-test level — see distill/wave-decisions.md DWD-01).
 */
export type GenerateFn = (
  modelId: string,
  messages: Array<{ role: string; content: string }>,
  options?: Record<string, unknown>,
) => Promise<{ text: string }>;

export type RestatementComposerDependencies = {
  generate: GenerateFn;
  modelId: string;
};

export type TicketIntentInput = {
  ticketRef: string;
  ticketTitle: string;
  ticketDescription: string;
};

/**
 * Composes the plain-language restatement of ticket intent posted to the ticket-scoped channel
 * before any run starts (US-04 AC1). Re-invoked by the Confirmation Gate whenever the submitter
 * corrects a prior restatement (US-04 AC3) — never itself decides confirm/correct.
 */
export async function composeRestatement(
  input: TicketIntentInput,
  deps: RestatementComposerDependencies,
): Promise<{ restatementText: string }> {
  throw new Error(
    `composeRestatement not implemented for ${input.ticketRef} — must call generate() ` +
      `(modelId: ${deps.modelId}) to produce a plain-language restatement of intent (US-04 ` +
      `AC1), returned for the Confirmation Gate to post to the ticket-scoped channel. Must not ` +
      `itself decide confirmation — that is the Confirmation Gate's responsibility.`,
  );
}

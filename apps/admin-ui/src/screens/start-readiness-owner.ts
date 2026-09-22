export type StartReadinessRequest = Readonly<{ signal: AbortSignal; generation: number; principalKey: string | undefined; agentId: string; isCurrent: () => boolean }>;

export function createStartReadinessOwner() {
  let generation = 0;
  let controller: AbortController | null = null;
  let principalKey: string | undefined;
  let agentId: string | null = null;

  function invalidate() {
    generation += 1;
    controller?.abort();
    controller = null;
    principalKey = undefined;
    agentId = null;
  }

  function begin(nextPrincipalKey: string | undefined, nextAgentId: string): StartReadinessRequest {
    invalidate();
    const requestGeneration = generation;
    const requestController = new AbortController();
    controller = requestController;
    principalKey = nextPrincipalKey;
    agentId = nextAgentId;
    return {
      signal: requestController.signal,
      generation: requestGeneration,
      principalKey: nextPrincipalKey,
      agentId: nextAgentId,
      isCurrent: () => !requestController.signal.aborted && requestGeneration === generation && principalKey === nextPrincipalKey && agentId === nextAgentId,
    };
  }

  return { begin, invalidate };
}

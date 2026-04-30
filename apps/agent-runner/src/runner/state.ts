export function createRunnerState() {
  const heartbeats = new Map<string, number>();
  const bootstrappedAgents = new Set<string>();
  const lifecycleChannels = new Map<string, string>();
  let registeredRunnerId: string | null = null;
  let lastRunnerHeartbeatAt = 0;

  return {
    heartbeats,
    bootstrappedAgents,
    lifecycleChannels,
    get registeredRunnerId() {
      return registeredRunnerId;
    },
    set registeredRunnerId(value: string | null) {
      registeredRunnerId = value;
    },
    get lastRunnerHeartbeatAt() {
      return lastRunnerHeartbeatAt;
    },
    set lastRunnerHeartbeatAt(value: number) {
      lastRunnerHeartbeatAt = value;
    },
  };
}

export type RunnerState = ReturnType<typeof createRunnerState>;

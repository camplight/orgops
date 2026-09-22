import type { RuntimeGeneration, TurnLease } from "@orgops/schemas";
import type { Agent, Event } from "./types";

type WorkerState = {
  key: string;
  agent: Agent;
  channelId: string;
  queue: Map<string, Event>;
  running: boolean;
  starts: number;
};

type CreateChannelLoopManagerInput = {
  captureForTurn: (agentId: string) => Promise<TurnLease>;
  processBatch: (agent: Agent, channelId: string, events: Event[], generation: RuntimeGeneration) => Promise<void>;
  onBatchError?: (
    agent: Agent,
    channelId: string,
    events: Event[],
    error: unknown,
  ) => Promise<void>;
};

function workerKey(agentName: string, channelId: string) {
  return `${agentName}::${channelId}`;
}

function freezeSnapshot(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const nested of Object.values(value)) freezeSnapshot(nested);
  Object.freeze(value);
}

function snapshotAgent(agent: Agent): Agent {
  const snapshot = structuredClone(agent);
  freezeSnapshot(snapshot);
  return snapshot;
}

export function createChannelLoopManager(input: CreateChannelLoopManagerInput) {
  const workers = new Map<string, WorkerState>();
  const workerStartCounts = new Map<string, number>();

  const startWorker = (key: string) => {
    const state = workers.get(key);
    if (!state || state.running) return;
    state.running = true;
    state.starts += 1;
    workerStartCounts.set(key, (workerStartCounts.get(key) ?? 0) + 1);
    void (async () => {
      while (true) {
        if (state.queue.size === 0) break;
        const batchAgent = snapshotAgent(state.agent);
        const batchChannelId = state.channelId;
        const batch = [...state.queue.values()].sort((left, right) => {
          const leftTs = left.createdAt ?? 0;
          const rightTs = right.createdAt ?? 0;
          return leftTs - rightTs;
        });
        state.queue.clear();
        let lease: TurnLease | undefined;
        try {
          if (!batchAgent.id) throw new Error("Agent ID is required for runtime generation capture.");
          lease = await input.captureForTurn(batchAgent.id);
          await input.processBatch(batchAgent, batchChannelId, batch, lease.generation);
        } catch (error) {
          if (input.onBatchError) {
            try {
              await input.onBatchError(batchAgent, batchChannelId, batch, error);
            } catch {
              // Batch error reporting is best-effort; lease release and worker cleanup remain mandatory.
            }
          }
        } finally {
          lease?.release();
        }
      }
    })().finally(() => {
      const latest = workers.get(key);
      if (!latest) return;
      latest.running = false;
      if (latest.queue.size === 0) {
        workers.delete(key);
        return;
      }
      startWorker(key);
    });
  };

  return {
    enqueue(agent: Agent, events: Event[]) {
      for (const event of events) {
        const channelId = event.channelId;
        if (!channelId) continue;
        const key = workerKey(agent.name, channelId);
        const state = workers.get(key) ?? {
          key,
          agent,
          channelId,
          queue: new Map<string, Event>(),
          running: false,
          starts: 0,
        };
        state.agent = agent;
        state.queue.set(event.id, event);
        workers.set(key, state);
        startWorker(key);
      }
    },
    activeWorkerCount() {
      return [...workers.values()].filter((worker) => worker.running).length;
    },
    workerStarts(agentName: string, channelId: string) {
      return workerStartCounts.get(workerKey(agentName, channelId)) ?? 0;
    },
    isChannelBusy(agentName: string, channelId: string) {
      const state = workers.get(workerKey(agentName, channelId));
      if (!state) return false;
      return state.running || state.queue.size > 0;
    },
  };
}

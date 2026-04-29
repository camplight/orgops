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
  processBatch: (agent: Agent, channelId: string, events: Event[]) => Promise<void>;
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
        const batch = [...state.queue.values()].sort((left, right) => {
          const leftTs = left.createdAt ?? 0;
          const rightTs = right.createdAt ?? 0;
          return leftTs - rightTs;
        });
        state.queue.clear();
        if (batch.length === 0) break;
        try {
          await input.processBatch(state.agent, state.channelId, batch);
        } catch (error) {
          if (input.onBatchError) {
            await input.onBatchError(state.agent, state.channelId, batch, error);
          }
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

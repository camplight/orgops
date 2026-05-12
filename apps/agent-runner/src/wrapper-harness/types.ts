import type { Agent, Event } from "../types";

export type WrapperRuntimeContext = {
  projectRoot: string;
  api: {
    apiFetch?: (path: string, init?: RequestInit) => Promise<Response>;
    emitEvent: (event: unknown) => Promise<void>;
    getPackageSecretsEnv: (agentName: string, channelId?: string) => Promise<Record<string, string>>;
  };
};

export type WrapperSessionScope = "per-channel" | "per-agent";

export type WrapperSourceConfig = {
  type?: unknown;
  repo?: unknown;
  ref?: unknown;
  path?: unknown;
  updateOnStart?: unknown;
};

export type WrapperCommandConfig = {
  command?: unknown;
  args?: unknown;
  cwd?: unknown;
  timeoutMs?: unknown;
  env?: unknown;
  parse?: unknown;
};

export type WrapperSetupConfig = WrapperCommandConfig & {
  checkCommand?: unknown;
};

export type WrapperSidecarConfig = WrapperCommandConfig & {
  name?: unknown;
  checkCommand?: unknown;
  restart?: unknown;
  restartDelayMs?: unknown;
};

export type NormalizedWrappedConfig = {
  kind: string;
  harness: string;
  source?: WrapperSourceConfig;
  setup?: WrapperSetupConfig;
  runtime?: WrapperCommandConfig;
  sidecars: WrapperSidecarConfig[];
  sessionScope: WrapperSessionScope;
  raw: Record<string, unknown>;
};

export type WrapperHarnessReadyInput = {
  ctx: WrapperRuntimeContext;
  agent: Agent;
  config: NormalizedWrappedConfig;
};

export type WrapperHarnessTurnInput = WrapperHarnessReadyInput & {
  events: Event[];
  triggerEvent: Event;
  channelId: string;
  message: string;
  sessionId: string;
};

export type WrapperHarnessTurnResult = {
  text?: string;
  raw?: unknown;
};

export type WrapperHarness = {
  name: string;
  canHandle: (config: NormalizedWrappedConfig) => boolean;
  ensureReady: (input: WrapperHarnessReadyInput) => Promise<void>;
  runTurn: (input: WrapperHarnessTurnInput) => Promise<WrapperHarnessTurnResult>;
};

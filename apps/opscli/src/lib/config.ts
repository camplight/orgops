import { resolve } from "node:path";

export const DEFAULT_OPENAI_MODEL_ID = "openai:gpt-5.2";
export const DEFAULT_ANTHROPIC_MODEL_ID = "anthropic:claude-3-5-sonnet-latest";
export const DEFAULT_OPENROUTER_MODEL_ID = "openrouter:openai/gpt-4o-mini";

export const COMMAND_TIMEOUT_MS = Number(
  process.env.ORGOPS_OPSCLI_COMMAND_TIMEOUT_MS ?? 120_000,
);
export const TOOL_LOOP_MAX_STEPS = Number(
  process.env.ORGOPS_OPSCLI_TOOL_LOOP_MAX_STEPS ?? 140,
);
export const MAX_OUTPUT_CHARS = 12_000;
export const MAX_INPUT_CHARS = 12_000;
export const MAX_CONTEXT_CHARS = Number(
  process.env.ORGOPS_OPSCLI_MAX_CONTEXT_CHARS ?? 100_000,
);
export const MAX_SUMMARY_CHARS = Number(
  process.env.ORGOPS_OPSCLI_MAX_SUMMARY_CHARS ?? 14_000,
);
export const SUMMARY_CHUNK_MESSAGES = Number(
  process.env.ORGOPS_OPSCLI_SUMMARY_CHUNK_MESSAGES ?? 8,
);
export const MIN_RECENT_MESSAGES = Number(
  process.env.ORGOPS_OPSCLI_MIN_RECENT_MESSAGES ?? 12,
);
export const MAX_SYSTEM_DOC_CHARS = Number(
  process.env.ORGOPS_OPSCLI_MAX_SYSTEM_DOC_CHARS ?? 40_000,
);
export const DOUBLE_SIGINT_WINDOW_MS = Number(
  process.env.ORGOPS_OPSCLI_DOUBLE_SIGINT_MS ?? 1200,
);
export const SESSION_LOG_PATH = resolve(
  process.cwd(),
  process.env.ORGOPS_OPSCLI_LOG_PATH ?? ".opscli-output.log",
);

export const PROGRESS_ENABLED = (() => {
  const raw = process.env.ORGOPS_OPSCLI_PROGRESS?.trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "off", "no"].includes(raw);
})();

export const SPINNER_ENABLED = (() => {
  const raw = process.env.ORGOPS_OPSCLI_SPINNER?.trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "off", "no"].includes(raw);
})();

export const ROOT_ENV_FILE = ".env";
export const DEFAULT_API_URL = "http://localhost:8787";
export const DEFAULT_RUNNER_TOKEN = "dev-runner-token";

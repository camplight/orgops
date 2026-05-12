import { commandWrapperHarness } from "./command";
import type { NormalizedWrappedConfig, WrapperHarness } from "./types";

const builtInHarnesses: WrapperHarness[] = [commandWrapperHarness];

export function getWrapperHarness(config: NormalizedWrappedConfig): WrapperHarness {
  const harness = builtInHarnesses.find((candidate) => candidate.canHandle(config));
  if (harness) return harness;
  const available = builtInHarnesses.map((candidate) => candidate.name).join(", ");
  throw new Error(
    `Unsupported wrapped harness "${config.harness}". Available harnesses: ${available}`,
  );
}

export function listWrapperHarnesses() {
  return builtInHarnesses.map((harness) => harness.name);
}

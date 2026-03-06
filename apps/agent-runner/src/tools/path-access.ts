import { isAbsolute, relative, resolve } from "node:path";
import type { Agent } from "../types";

function isInside(root: string, candidate: string) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function getAllowedRoots(agent: Agent): string[] {
  if (agent.allowOutsideWorkspace) {
    return [resolve("/")];
  }
  return [resolve(agent.workspacePath)];
}

export function resolveAgentPath(
  agent: Agent,
  value: string,
  extraAllowedRoots: string[] = [],
): string {
  const workspaceRoot = resolve(agent.workspacePath);
  const candidate = isAbsolute(value)
    ? resolve(value)
    : resolve(workspaceRoot, value);
  const allowedRoots = [
    ...getAllowedRoots(agent),
    ...extraAllowedRoots
      .map((root) => root.trim())
      .filter(Boolean)
      .map((root) => resolve(root)),
  ];
  if (allowedRoots.some((root) => isInside(root, candidate))) {
    return candidate;
  }
  throw new Error(
    `Path is outside allowed roots: ${value}. Allowed roots: ${allowedRoots.join(", ")}`,
  );
}

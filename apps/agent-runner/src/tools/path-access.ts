import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { Agent } from "../types";

function isInside(root: string, candidate: string) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function canonicalRoot(root: string): string {
  try {
    return realpathSync.native(root);
  } catch {
    return resolve(root);
  }
}

function canonicalCandidate(candidate: string): string {
  if (existsSync(candidate)) return realpathSync.native(candidate);

  const missing: string[] = [];
  let parent = candidate;
  while (!existsSync(parent)) {
    const next = dirname(parent);
    if (next === parent) return resolve(candidate);
    missing.unshift(parent.slice(next.length + 1));
    parent = next;
  }
  const canonicalParent = realpathSync.native(parent);
  return resolve(canonicalParent, ...missing);
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
  ].map(canonicalRoot);
  const canonicalPath = canonicalCandidate(candidate);
  if (allowedRoots.some((root) => isInside(root, canonicalPath))) {
    return canonicalPath;
  }
  throw new Error(
    `Path is outside allowed roots: ${value}. Allowed roots: ${allowedRoots.join(", ")}`,
  );
}

import { lstatSync, readlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Agent } from "../types";

function canonicalize(pathValue: string) {
  let current: string = sep;
  let remaining = resolve(pathValue).slice(1).split(sep).filter(Boolean);
  for (let hop = 0; hop < 40 && remaining.length > 0; hop += 1) {
    const next = join(current, remaining.shift()!);
    try {
      const stat = lstatSync(next);
      if (stat.isSymbolicLink()) {
        const link = readlinkSync(next);
        current = resolve(dirname(next), link);
      } else {
        current = next;
      }
    } catch {
      current = join(current, next.slice(dirname(next).length + 1), ...remaining);
      break;
    }
  }
  return current;
}

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
  const workspaceRoot = canonicalize(agent.workspacePath);
  const candidate = canonicalize(
    isAbsolute(value) ? resolve(value) : resolve(workspaceRoot, value),
  );
  const allowedRoots = [
    ...getAllowedRoots(agent).map(canonicalize),
    ...extraAllowedRoots
      .map((root) => root.trim())
      .filter(Boolean)
      .map((root) => canonicalize(root)),
  ];
  if (allowedRoots.some((root) => isInside(root, candidate))) {
    return candidate;
  }
  throw new Error(
    `Path is outside allowed roots: ${value}. Allowed roots: ${allowedRoots.join(", ")}`,
  );
}

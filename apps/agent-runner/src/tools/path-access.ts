import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Agent } from "../types";

function canonicalize(pathValue: string) {
  let current = resolve(pathValue);
  const missing: string[] = [];
  while (true) {
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        throw new Error(`Unable to resolve path: ${pathValue}`);
      }
      const parent = dirname(current);
      if (parent === current) {
        throw new Error(`Unable to resolve path: ${pathValue}`);
      }
      missing.push(basename(current));
      current = parent;
      continue;
    }
    let canonical: string;
    try {
      canonical = realpathSync(current);
    } catch {
      throw new Error(`Unable to resolve path: ${pathValue}`);
    }
    return missing.length > 0 ? join(canonical, ...missing.reverse()) : canonical;
  }
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

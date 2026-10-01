import { existsSync, lstatSync, realpathSync } from "node:fs";
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

function hasDisallowedSymlinkComponent(candidate: string, allowedRootPaths: string[]): boolean {
  let current = candidate;
  while (true) {
    if (!allowedRootPaths.includes(current)) {
      try {
        if (lstatSync(current).isSymbolicLink()) return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") return true;
      }
    }
    const next = dirname(current);
    if (next === current) return false;
    current = next;
  }
}

function canonicalCandidate(candidate: string, allowedRootPaths: string[]): string {
  if (hasDisallowedSymlinkComponent(candidate, allowedRootPaths)) {
    throw new Error("Path contains a disallowed symbolic link");
  }
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
  const allowedRootPaths = [
    ...getAllowedRoots(agent),
    ...extraAllowedRoots
      .map((root) => root.trim())
      .filter(Boolean)
      .map((root) => resolve(root)),
  ];
  const allowedRoots = allowedRootPaths.map(canonicalRoot);
  let canonicalPath: string;
  try {
    canonicalPath = canonicalCandidate(candidate, allowedRootPaths);
  } catch {
    throw new Error(
      `Path is outside allowed roots: ${value}. Allowed roots: ${allowedRoots.join(", ")}`,
    );
  }
  if (allowedRoots.some((root) => isInside(root, canonicalPath))) {
    return canonicalPath;
  }
  throw new Error(
    `Path is outside allowed roots: ${value}. Allowed roots: ${allowedRoots.join(", ")}`,
  );
}

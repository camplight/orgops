import { z } from "zod";
import type { ExecuteContext, ToolDef } from "./types";
import { resolveAgentPath } from "./path-access";

const fsReadSchema = z.object({ path: z.string().min(1) });
const fsWriteSchema = z.object({ path: z.string().min(1), content: z.string() });
const fsListSchema = z.object({ path: z.string().min(1) });
const fsStatSchema = z.object({ path: z.string().min(1) });
const fsMkdirSchema = z.object({ path: z.string().min(1) });
const fsRmSchema = z.object({ path: z.string().min(1) });
const fsMoveSchema = z.object({ path: z.string().min(1), to: z.string().min(1) });

export const fsToolDefs: ToolDef[] = [
  ["fs_read", "Read a file.", fsReadSchema],
  [
    "fs_write",
    "Write a file.",
    fsWriteSchema,
  ],
  ["fs_list", "List a directory.", fsListSchema],
  ["fs_stat", "Stat a path.", fsStatSchema],
  ["fs_mkdir", "Create a directory.", fsMkdirSchema],
  ["fs_rm", "Remove a file or directory.", fsRmSchema],
  [
    "fs_move",
    "Move or rename a path.",
    fsMoveSchema,
  ],
];

function formatZodIssues(error: z.ZodError) {
  return error.issues
    .slice(0, 6)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function parseToolArgs<T>(
  tool: string,
  schema: z.ZodType<T>,
  args: Record<string, unknown>,
): { ok: true; data: T } | { ok: false; error: string } {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Invalid arguments for ${tool}: ${formatZodIssues(parsed.error)}`,
    };
  }
  return { ok: true, data: parsed.data };
}

export async function execute(
  ctx: ExecuteContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const fs = await import("node:fs/promises");
  const toWorkspacePath = (value: string) => {
    if (!value) return value;
    return resolveAgentPath(ctx.agent, value, ctx.extraAllowedRoots ?? []);
  };

  if (tool === "fs_read") {
    const parsedResult = parseToolArgs(tool, fsReadSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const path = toWorkspacePath(parsedResult.data.path);
    const content = await fs.readFile(path, "utf-8");
    return { content };
  }
  if (tool === "fs_write") {
    const parsedResult = parseToolArgs(tool, fsWriteSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const path = toWorkspacePath(parsedResult.data.path);
    await fs.writeFile(path, parsedResult.data.content);
    return { ok: true };
  }
  if (tool === "fs_list") {
    const parsedResult = parseToolArgs(tool, fsListSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const path = toWorkspacePath(parsedResult.data.path);
    const items = await fs.readdir(path);
    return { items };
  }
  if (tool === "fs_stat") {
    const parsedResult = parseToolArgs(tool, fsStatSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const path = toWorkspacePath(parsedResult.data.path);
    const stat = await fs.stat(path);
    return { stat };
  }
  if (tool === "fs_mkdir") {
    const parsedResult = parseToolArgs(tool, fsMkdirSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const path = toWorkspacePath(parsedResult.data.path);
    await fs.mkdir(path, { recursive: true });
    return { ok: true };
  }
  if (tool === "fs_rm") {
    const parsedResult = parseToolArgs(tool, fsRmSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const path = toWorkspacePath(parsedResult.data.path);
    await fs.rm(path, { recursive: true, force: true });
    return { ok: true };
  }
  if (tool === "fs_move") {
    const parsedResult = parseToolArgs(tool, fsMoveSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const path = toWorkspacePath(parsedResult.data.path);
    const to = toWorkspacePath(parsedResult.data.to);
    await fs.rename(path, to);
    return { ok: true };
  }
  return { error: `Unknown fs tool: ${tool}` };
}

import { z } from "zod";
import type { ExecuteContext, ToolDef } from "./types";
import { resolveAgentPath } from "./path-access";

export const fsToolDefs: ToolDef[] = [
  ["fs_read", "Read a file.", z.object({ path: z.string() })],
  [
    "fs_write",
    "Write a file.",
    z.object({ path: z.string(), content: z.string() }),
  ],
  ["fs_list", "List a directory.", z.object({ path: z.string() })],
  ["fs_stat", "Stat a path.", z.object({ path: z.string() })],
  ["fs_mkdir", "Create a directory.", z.object({ path: z.string() })],
  ["fs_rm", "Remove a file or directory.", z.object({ path: z.string() })],
  [
    "fs_move",
    "Move or rename a path.",
    z.object({ path: z.string(), to: z.string() }),
  ],
];

export async function execute(
  ctx: ExecuteContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const fs = await import("node:fs/promises");
  const rawPath = String(args.path ?? "");
  const rawTo = String(args.to ?? "");
  const toWorkspacePath = (value: string) => {
    if (!value) return value;
    return resolveAgentPath(ctx.agent, value, ctx.extraAllowedRoots ?? []);
  };
  const path = toWorkspacePath(rawPath);
  const to = toWorkspacePath(rawTo);
  const audit = () =>
    ctx.emitAudit("audit.fs.read", {
      agentName: ctx.agent.name,
      channelId: ctx.channelId,
      rawPath,
      path,
    });
  const auditWrite = () =>
    ctx.emitAudit("audit.fs.write", {
      agentName: ctx.agent.name,
      channelId: ctx.channelId,
      rawPath,
      path,
      ...(tool === "fs_move" ? { rawTo, to } : {}),
    });

  if (tool === "fs_read") {
    const content = await fs.readFile(path, "utf-8");
    await audit();
    return { content };
  }
  if (tool === "fs_write") {
    await fs.writeFile(path, String(args.content ?? ""));
    await auditWrite();
    return { ok: true };
  }
  if (tool === "fs_list") {
    const items = await fs.readdir(path);
    await audit();
    return { items };
  }
  if (tool === "fs_stat") {
    const stat = await fs.stat(path);
    await audit();
    return { stat };
  }
  if (tool === "fs_mkdir") {
    await fs.mkdir(path, { recursive: true });
    await auditWrite();
    return { ok: true };
  }
  if (tool === "fs_rm") {
    await fs.rm(path, { recursive: true, force: true });
    await auditWrite();
    return { ok: true };
  }
  if (tool === "fs_move") {
    await fs.rename(path, to);
    await auditWrite();
    return { ok: true };
  }
  throw new Error(`Unknown fs tool: ${tool}`);
}

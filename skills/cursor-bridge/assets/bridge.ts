#!/usr/bin/env node
/**
 * cursor-bridge v1 (CLI)
 *
 * Minimal vertical slice:
 *   - reads CURSOR_API_KEY from env (presence check only)
 *   - sends a prompt to Cursor via official `@cursor/sdk`
 *   - streams assistant text to stdout
 */

import process from "node:process";

type Args = {
  prompt?: string;
  model?: string;
  cwd?: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--prompt" || a === "-p") out.prompt = argv[++i];
    else if (a === "--model" || a === "-m") out.model = argv[++i];
    else if (a === "--cwd") out.cwd = argv[++i];
    else if (a === "--help" || a === "-h") {
      printHelpAndExit(0);
    }
  }
  return out;
}

function printHelpAndExit(code: number): never {
  const msg = `cursor-bridge (CLI)\n\nUsage:\n  node --import tsx skills/cursor-bridge/assets/bridge.ts --prompt "..."\n\nOptions:\n  --prompt, -p        Prompt text (required)\n  --model, -m         Model id (optional; default: composer-2)\n  --cwd               Local workspace cwd for Cursor local context (optional; default: process.cwd())\n`;
  process.stdout.write(msg);
  process.exit(code);
}

function extractTextFromMessageContent(content: any): string {
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const part of content) {
    if (part?.type === "text" && typeof part.text === "string") out += part.text;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.prompt) printHelpAndExit(2);

  // Presence check only; never print secret.
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "CURSOR_API_KEY is not set in environment. Set OrgOps secret package 'cursor' key 'CURSOR_API_KEY'.\n"
    );
    process.exit(3);
  }

  // Lazy import so `--help` works without deps.
  let Agent: any;
  try {
    ({ Agent } = await import("@cursor/sdk"));
  } catch (e: any) {
    process.stderr.write(
      `Failed to import '@cursor/sdk'. Ensure dependency is installed. Error: ${e?.message ?? String(e)}\n`
    );
    process.exit(4);
  }

  const modelId = args.model || "composer-2";
  const cwd = args.cwd || process.cwd();

  try {
    const agent = await Agent.create({
      apiKey,
      model: { id: modelId },
      local: { cwd },
    });

    const run = await agent.send(args.prompt);

    let printed = "";
    for await (const ev of run.stream()) {
      if (ev?.type === "assistant") {
        const delta = extractTextFromMessageContent(ev?.message?.content);
        if (delta) {
          printed += delta;
          process.stdout.write(delta);
        }
      }

      if (ev?.type === "status" && ev?.status === "completed") break;
      if (ev?.type === "status" && ev?.status === "failed") {
        process.stderr.write("\nCursor run failed.\n");
        process.exit(6);
      }
      if (ev?.type === "status" && ev?.status === "cancelled") {
        process.stderr.write("\nCursor run cancelled.\n");
        process.exit(7);
      }
    }

    if (!printed.endsWith("\n")) process.stdout.write("\n");
  } catch (e: any) {
    process.stderr.write(`Cursor request failed: ${e?.message ?? String(e)}\n`);
    process.exit(6);
  }
}

main();

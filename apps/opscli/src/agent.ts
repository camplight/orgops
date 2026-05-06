import { hostname } from "node:os";
import { generate, type LlmMessage } from "@orgops/llm";
import { TOOL_LOOP_MAX_STEPS, MAX_INPUT_CHARS } from "./config";
import { appendSessionLog } from "./logger";
import { appendHistoryMessage } from "./memory";
import { buildSystemPrompt } from "./prompt";
import { createOpsCliTools } from "./tools";
import type { AgentRuntimeState, SessionMemory } from "./types";
import { TaskInterruptedError } from "./types";
import { reportProgress, startSpinner, writeRoleMessage, forceStopSpinner } from "./ui";
import { summarizeToolResults, toDisplayError, truncateText } from "./utils";

function isAbortError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; message?: string };
  return (
    candidate.name === "AbortError" ||
    candidate.name === "TaskInterruptedError" ||
    candidate.message?.toLowerCase().includes("aborted") === true
  );
}

async function synthesizeFinalAnswerFromToolResults(input: {
  modelId: string;
  baseMessages: LlmMessage[];
  toolResults: unknown[];
  abortSignal?: AbortSignal;
}) {
  const { modelId, baseMessages, toolResults, abortSignal } = input;
  const synthesis = await generate(
    modelId,
    [
      ...baseMessages,
      {
        role: "system",
        content: JSON.stringify({ type: "opscli.tool_results", results: toolResults }, null, 2),
      },
      {
        role: "system",
        content:
          "Write a concise direct answer to the user based on the tool results. Explicitly state success/failure and key evidence. Do not call any tools.",
      },
    ],
    { abortSignal }
  );
  return (synthesis.text ?? "").trim();
}

export async function runAgentTurn(input: {
  modelId: string;
  docsText: string;
  promptText: string;
  memory: SessionMemory;
  requestPasswordInput: (promptText: string) => Promise<string>;
  abortSignal?: AbortSignal;
}) {
  const { modelId, docsText, promptText, memory, requestPasswordInput, abortSignal } = input;
  const runtime: AgentRuntimeState = { requestedExit: false, exitCode: 0 };

  appendHistoryMessage(memory, {
    role: "user",
    content: JSON.stringify(
      {
        type: "opscli.prompt",
        text: truncateText(promptText, MAX_INPUT_CHARS).text,
        isEmpty: promptText.trim().length === 0,
        host: {
          platform: process.platform,
          arch: process.arch,
          hostname: hostname(),
          cwd: process.cwd(),
        },
      },
      null,
      2
    ),
  });

  const modelMessages: LlmMessage[] = [{ role: "system", content: buildSystemPrompt(docsText) }];
  if (memory.summary.trim()) {
    modelMessages.push({ role: "system", content: `Session rolling summary:\n${memory.summary}` });
  }
  modelMessages.push(...memory.history);

  reportProgress("running agent with tools", { leadingNewline: true });
  const spinner = startSpinner("Thinking");
  const tools = createOpsCliTools({
    requestPasswordInput: async (question: string) => {
      spinner.stop("Waiting for secure input.");
      return requestPasswordInput(question);
    },
    forceExitProcess: (code: number) => {
      forceStopSpinner();
      process.exit(code);
    },
    abortSignal,
    runtime,
    reportProgress: (message: string) => reportProgress(message),
    appendLog: (message: string) => appendSessionLog(message),
  });
  const executedToolResults: unknown[] = [];
  const trackedTools = Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const originalExecute = tool.execute;
      if (!originalExecute) return [name, tool];
      return [
        name,
        {
          ...tool,
          execute: async (args: Record<string, unknown>) => {
            try {
              const output = await originalExecute(args);
              executedToolResults.push({ tool: name, args, ok: true, output });
              return output;
            } catch (error) {
              executedToolResults.push({ tool: name, args, ok: false, error: String(error) });
              throw error;
            }
          },
        },
      ];
    })
  );
  try {
    const result = await generate(modelId, modelMessages, {
      tools: trackedTools,
      maxSteps: TOOL_LOOP_MAX_STEPS,
      abortSignal,
    });
    const toolResults =
      Array.isArray(result.toolResults) && result.toolResults.length > 0
        ? result.toolResults
        : executedToolResults;
    let assistantText = (result.text ?? "").trim();
    if (!assistantText && toolResults.length > 0) {
      assistantText = await synthesizeFinalAnswerFromToolResults({
        modelId,
        baseMessages: modelMessages,
        toolResults,
        abortSignal,
      });
    }

    const finalText = assistantText || summarizeToolResults(toolResults);
    appendHistoryMessage(memory, { role: "assistant", content: finalText });
    writeRoleMessage("agent", finalText, { leadingNewline: true });
    appendSessionLog(
      `agent finishReason=${String(result.finishReason ?? "unknown")} text=${JSON.stringify(truncateText(finalText, 4000).text)}`
    );

    return { requestedExit: runtime.requestedExit, exitCode: runtime.exitCode };
  } catch (error) {
    if (error instanceof TaskInterruptedError || isAbortError(error)) {
      appendSessionLog("agent interrupted");
      forceStopSpinner();
      writeRoleMessage("opscli", "Interrupted current run. You can now ask follow-ups or retry.", {
        leadingNewline: true,
      });
      return { requestedExit: false, exitCode: 0 };
    }
    const text = toDisplayError(error);
    throw new Error(text);
  } finally {
    spinner.stop("Run complete.");
  }
}

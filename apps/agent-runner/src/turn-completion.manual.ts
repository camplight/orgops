import { strict as assert } from "node:assert";
import { generate, type LlmMessage, type LlmTool } from "@orgops/llm";
import { z } from "zod";
import { buildRunnerGuidance } from "./prompt";
import {
  completionFromJson,
  completionFromPlainText,
} from "./turn-completion";

const MODEL_ID = process.env.ORGOPS_MANUAL_COMPLETION_MODEL?.trim() || "openai:gpt-5.5";
const testApiKey = process.env.TEST_OPENAI_API_KEY?.trim();

if (!testApiKey) {
  throw new Error("TEST_OPENAI_API_KEY is required for the manual turn-completion test.");
}

let artifactCreated = false;
const createArtifactTool: LlmTool = {
  description: "Write content to a file in the agent workspace.",
  inputSchema: z.object({
    filename: z.string().min(1),
    title: z.string().min(1),
  }),
  execute: async ({ filename, title }) => {
    artifactCreated = true;
    return { created: true, filename, title };
  },
};

const guidance = buildRunnerGuidance(
  Date.now(),
  new Date().toISOString(),
  [],
  [],
  {
    platform: process.platform,
    release: "manual-test",
    arch: process.arch,
    hostname: "manual-test-host",
    shell: "/bin/sh",
    nodeVersion: process.version,
  },
  { replyContract: "json", agentName: "Builder" },
);

const messages: LlmMessage[] = [
    { role: "system", content: guidance },
    {
      role: "system",
      content:
        "Approval workflow: before creating a new artifact, ask for explicit approval. After approval, acknowledge that you are starting and will return the result or a concrete blocker, then carry out the approved work.",
    },
    {
      role: "assistant",
      content:
        "Please confirm: do you approve creating the standalone HTML file demo-prototype.html within the fixed budget?",
    },
    {
      role: "user",
      content:
        "Yes, I approve creating the standalone HTML file demo-prototype.html within the fixed budget. Start now.",
    },
];

let result: Awaited<ReturnType<typeof generate>> | undefined;
let completion: ReturnType<typeof completionFromJson> = null;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  result = await generate(MODEL_ID, messages, {
    tools: { create_artifact: createArtifactTool },
    maxSteps: 4,
    maxTokens: 1_200,
    env: { OPENAI_API_KEY: testApiKey },
  });
  completion =
    completionFromJson(result.text ?? "") ??
    completionFromPlainText(result.text ?? "");
  if (completion) break;

  if (result.responseMessages?.length) {
    messages.push(...result.responseMessages);
  } else if (result.text?.trim()) {
    messages.push({ role: "assistant", content: result.text.trim() });
  }
  messages.push({
    role: "system",
    content: [
      `Your previous response did not include a valid turn completion outcome. This is correction attempt ${attempt}/3.`,
      "Continue unfinished work now using tools.",
      "Return one final JSON event with turnStatus WORK_FULLY_COMPLETE only after the requested work is actually finished.",
    ].join(" "),
  });
}

assert.ok(result, "The model did not return a result.");

console.log(
  JSON.stringify(
    {
      model: MODEL_ID,
      finishReason: result.finishReason,
      toolCalls: (result.toolCalls ?? []).map(
        (call) => (call as { toolName?: unknown }).toolName,
      ),
      artifactCreated,
      completionStatus: completion?.status ?? null,
      responsePreview: (result.text ?? "").slice(0, 300),
    },
    null,
    2,
  ),
);

assert.equal(
  artifactCreated,
  true,
  "The model ended the turn before performing the approved artifact creation.",
);
assert.equal(
  completion?.status,
  "WORK_FULLY_COMPLETE",
  "The model did not mark the finished work as WORK_FULLY_COMPLETE.",
);

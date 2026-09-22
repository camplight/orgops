import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// Replace only external/model and host-facing boundaries; execute the real turn.
async function loadAgentTurn() {
  const { outputFiles } = await build({
    entryPoints: ["src/lib/agent.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [{
      name: "turn-test-boundaries",
      setup(build) {
        const modules = {
          "@orgops/llm": "export const generate = (...args) => globalThis.opscliTestGenerate(...args);",
          "../tools": "export const createOpsCliTools = () => ({ test_tool: { execute: async () => 'tool output' } });",
          "./logger": "export const appendSessionLog = () => {};",
          "./ui": "export const reportProgress = () => {}; export const writeRoleMessage = () => {}; export const forceStopSpinner = () => {}; export const startSpinner = () => ({ stop() {} });",
        };
        build.onResolve({ filter: /^(?:@orgops\/llm|\.\.\/tools|\.\/(?:logger|ui))$/ }, (args) => ({ path: args.path, namespace: "test-boundary" }));
        build.onLoad({ filter: /.*/, namespace: "test-boundary" }, (args) => ({ contents: modules[args.path], loader: "js" }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}

test("opscli bounds tool calls and rejects empty final responses without recording success", async (t) => {
  const previousMaxSteps = process.env.ORGOPS_OPSCLI_TOOL_LOOP_MAX_STEPS;
  t.after(() => {
    if (previousMaxSteps === undefined) delete process.env.ORGOPS_OPSCLI_TOOL_LOOP_MAX_STEPS;
    else process.env.ORGOPS_OPSCLI_TOOL_LOOP_MAX_STEPS = previousMaxSteps;
  });
  delete process.env.ORGOPS_OPSCLI_TOOL_LOOP_MAX_STEPS;
  const { runAgentTurn } = await loadAgentTurn();
  const memory = { summary: "", history: [] };
  let calls = 0;
  globalThis.opscliTestGenerate = async (modelId, messages, options) => {
    calls += 1;
    assert.equal(modelId, "test:model");
    assert.equal(messages.at(-1).role, "user");
    assert.equal(options.maxSteps, 140);
    assert.equal(await options.tools.test_tool.execute({}), "tool output");
    return { text: "   ", toolResults: [{ tool: "test_tool", output: "tool output" }] };
  };
  try {
    await assert.rejects(runAgentTurn({
      modelId: "test:model",
      docsText: "Test documentation",
      promptText: "Test prompt",
      memory,
      requestPasswordInput: async () => { throw new Error("Unexpected password request"); },
    }), /Model returned an empty final response/);
    assert.equal(calls, 1, "An empty answer must not trigger an extra synthesis call");
    assert.deepEqual(memory.history.map((message) => message.role), ["user"]);
  } finally {
    delete globalThis.opscliTestGenerate;
  }
const AGENT_SOURCE = resolve(process.cwd(), "src/lib/agent.ts");

test("opscli agent uses llm tools with bounded internal loop", () => {
  const source = readFileSync(AGENT_SOURCE, "utf-8");

  assert.ok(
    source.includes("const tools = createOpsCliTools"),
    "Agent should build tools from modular tool registry."
  );

  assert.ok(
    source.includes("const result = await generate(modelId, modelMessages, {"),
    "Agent should call generate with model messages."
  );

  assert.ok(
    source.includes("maxSteps: TOOL_LOOP_MAX_STEPS"),
    "Agent should use internal tool-loop cap from config."
  );

  assert.ok(
    source.includes('throw new Error("Model returned an empty final response.");'),
    "Agent should fail loudly when model returns empty final text."
  );
});

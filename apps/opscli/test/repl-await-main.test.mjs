import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import * as repl from "node:repl";

async function evaluateInRepl(code, promptValue) {
  const input = new PassThrough();
  const output = new PassThrough();
  const server = repl.start({
    prompt: "",
    terminal: false,
    input,
    output,
    useGlobal: false,
    ignoreUndefined: false,
    useColors: false,
  });

  const events = [];
  const context = server.context;
  context.prompt = promptValue;
  context.print = (...args) => {
    events.push({ type: "print", text: args.map((arg) => String(arg)).join(" ") });
  };
  context.shell = async (command) => {
    events.push({ type: "shell", command });
    return `mock-shell:${command}`;
  };
  context.finish = () => {
    events.push({ type: "finish" });
    return "Turn finished.";
  };

  try {
    const scriptValue = await new Promise((resolve, reject) => {
      server.eval(code, context, "opscli-repl-test", (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });

    const value =
      scriptValue && typeof scriptValue.then === "function"
        ? await scriptValue
        : scriptValue;
    return { events, value };
  } finally {
    server.close();
    input.end();
    output.end();
    input.destroy();
    output.destroy();
  }
}

function createReplHarness(initialPrompt = { text: "" }) {
  const input = new PassThrough();
  const output = new PassThrough();
  const server = repl.start({
    prompt: "",
    terminal: false,
    input,
    output,
    useGlobal: false,
    ignoreUndefined: false,
    useColors: false,
  });

  const context = server.context;
  const allEvents = [];
  context.prompt = initialPrompt;
  context.print = (...args) => {
    allEvents.push({ type: "print", text: args.map((arg) => String(arg)).join(" ") });
  };
  context.shell = async (command) => {
    allEvents.push({ type: "shell", command });
    return `mock-shell:${command}`;
  };
  context.finish = () => {
    allEvents.push({ type: "finish" });
    return "Turn finished.";
  };

  return {
    async eval(code, promptValue) {
      if (promptValue !== undefined) {
        context.prompt = promptValue;
      }
      const startIndex = allEvents.length;
      const scriptValue = await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error("REPL test eval timed out while waiting for callback"));
        }, 3000);
        server.eval(code, context, "opscli-repl-test", (error, result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) {
            reject(error);
            return;
          }
          resolve(result);
        });
      });
      const value =
        scriptValue && typeof scriptValue.then === "function"
          ? await scriptValue
          : scriptValue;
      return { value, events: allEvents.slice(startIndex) };
    },
    close() {
      server.close();
      input.end();
      output.end();
      input.destroy();
      output.destroy();
    },
  };
}

const snippet = `
async function main() {
  const goalText = (globalThis.prompt && (globalThis.prompt.text ?? globalThis.prompt)) || '';
  if (!goalText) {
    print('No prompt provided. Tell me what to start (api/ui/runner/all).');
    return finish();
  }
  print('before shell');
  await shell('echo probe shell ok');
  print('after shell');
  return finish();
}

await main();
`;

test("await main() reaches shell when prompt is present", async () => {
  const { events, value } = await evaluateInRepl(snippet, { text: "start it" });
  assert.equal(value, "Turn finished.");
  assert.deepEqual(events, [
    { type: "print", text: "before shell" },
    { type: "shell", command: "echo probe shell ok" },
    { type: "print", text: "after shell" },
    { type: "finish" },
  ]);
});

test("await main() exits early when prompt is empty", async () => {
  const { events, value } = await evaluateInRepl(snippet, { text: "" });
  assert.equal(value, "Turn finished.");
  assert.deepEqual(events, [
    {
      type: "print",
      text: "No prompt provided. Tell me what to start (api/ui/runner/all).",
    },
    { type: "finish" },
  ]);
});

test("same REPL session handles first and second goals", async () => {
  const harness = createReplHarness({ text: "goal one" });
  const perGoalSnippet = `
print("goal:", (globalThis.prompt && (globalThis.prompt.text ?? globalThis.prompt)) || "");
finish();
`;

  try {
    const first = await harness.eval(perGoalSnippet, { text: "goal one" });
    assert.equal(first.value, "Turn finished.");
    assert.deepEqual(first.events, [
      { type: "print", text: "goal: goal one" },
      { type: "finish" },
    ]);

    const second = await harness.eval(perGoalSnippet, { text: "goal two" });
    assert.equal(second.value, "Turn finished.");
    assert.deepEqual(second.events, [
      { type: "print", text: "goal: goal two" },
      { type: "finish" },
    ]);
  } finally {
    harness.close();
  }
});


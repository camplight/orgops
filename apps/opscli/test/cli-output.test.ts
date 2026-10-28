import test from "node:test";
import assert from "node:assert/strict";
import { extractGlobalFlags, setCliModes, emitOk, isJsonMode, isYesMode } from "../src/lib/cli-output.ts";

test("extractGlobalFlags pulls --json and --yes from any position", () => {
  const parsed = extractGlobalFlags(["--yes", "install", "--dir", "x", "--json"]);
  assert.deepEqual(parsed.flags, { json: true, yes: true });
  assert.deepEqual(parsed.rest, ["install", "--dir", "x"]);
});

test("emitOk writes a single JSON object in json mode", () => {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    setCliModes({ json: true, yes: true });
    assert.equal(isJsonMode(), true);
    assert.equal(isYesMode(), true);
    emitOk("doctor", { ok: true }, ["ignored"]);
    const payload = JSON.parse(writes.join(""));
    assert.equal(payload.ok, true);
    assert.equal(payload.command, "doctor");
    assert.deepEqual(payload.result, { ok: true });
  } finally {
    process.stdout.write = original;
    setCliModes({ json: false, yes: false });
  }
});

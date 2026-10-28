import test from "node:test";
import assert from "node:assert/strict";
import { capture } from "../src/lib/exec.ts";

test("capture preserves arguments that contain spaces", () => {
  const result = capture(process.execPath, [
    "-e",
    "process.stdout.write(JSON.stringify(process.argv.slice(-2)))",
    "one two",
    "user.name=OrgOps OpsCLI",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout ?? "[]"), ["one two", "user.name=OrgOps OpsCLI"]);
});

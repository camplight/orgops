import test from "node:test";
import assert from "node:assert/strict";
import { formatComponents, parseComponentsArg } from "../src/lib/components.ts";

test("parseComponentsArg defaults to the full desktop set", () => {
  assert.deepEqual(parseComponentsArg(undefined), ["api", "runner", "admin-ui", "user-ui"]);
});

test("parseComponentsArg accepts aliases and rejects unknown names", () => {
  assert.deepEqual(parseComponentsArg("runner,admin"), ["runner", "admin-ui"]);
  assert.equal(formatComponents(["api", "user-ui"]), "api, user-ui");
  assert.throws(() => parseComponentsArg("api,site"), /Unknown component/);
});

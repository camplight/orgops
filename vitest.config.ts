import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // These use node:test and run from the opscli workspace via its test script.
    exclude: [...configDefaults.exclude, "apps/opscli/test/*.test.mjs"],
  },
});

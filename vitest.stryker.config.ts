import { defineConfig } from "vitest/config";

// Test-file scope for Stryker mutation runs against the nwave-invocation-engine feature.
// Pinned explicitly (rather than relying on Stryker's `vitest.related` narrowing) because
// vitest's related-file detection does not reliably trace the cross-package bare specifier
// import `@orgops/api/src/app` (resolved through a workspace `file:` symlink in node_modules)
// back to `apps/api/src/routes/nwave-runs.ts`. With `related: true`, mutants inside that
// file's route handlers were incorrectly reported as uncovered even though
// nwave-invocation.test.ts exercises them through `createRealApiApp()`. Pinning this include
// list guarantees the same 82 tests our manual `vitest run` command exercises are always the
// candidate pool; Stryker's own runtime perTest coverage instrumentation (not vitest's static
// related-file graph) then narrows per-mutant test selection accurately.
export default defineConfig({
  test: {
    include: [
      "apps/agent-runner/src/nwave-invocation/**/*.test.ts",
      "apps/api/src/app.test.ts",
      "apps/agent-runner/src/multi-source-ingestion-governance/**/*.test.ts",
    ],
  },
});

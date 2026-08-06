/**
 * Architecture-boundary enforcement for the nWave Ticket Execution Engine feature.
 *
 * Encodes the module-boundary rules every one of this feature's four DESIGN-wave tracks
 * committed to in docs/product/architecture/brief.md ("Architecture Enforcement" section of
 * each track) and the ADRs listed below. This file is the DEVOPS-wave artifact that makes those
 * rules CI-checkable rather than convention-only (see
 * docs/feature/nwave-ticket-execution-engine/devops/ci-cd-pipeline.md).
 *
 * Run: npx depcruise apps/agent-runner/src --config .dependency-cruiser.cjs
 *
 * NOTE: this config targets the four new nwave-* modules under apps/agent-runner/src/. Module
 * paths below (e.g. apps/agent-runner/src/nwave-invocation/**) reflect the DESIGN-wave brief.md
 * naming; if software-crafter's DELIVER-wave implementation uses different directory names,
 * this file's `path` patterns must be updated to match — the *rule*, not the exact path string,
 * is the ADR-mandated invariant.
 */
module.exports = {
  forbidden: [
    {
      name: "no-nwave-invocation-into-wrapper-harness",
      comment:
        "ADR-0001: nwave-invocation must not import wrapper-harness/** (the deliberate non-extension boundary).",
      severity: "error",
      from: { path: "^apps/agent-runner/src/nwave-invocation" },
      to: { path: "^apps/agent-runner/src/wrapper-harness" },
    },
    {
      name: "no-nwave-invocation-pure-logic-io",
      comment:
        "brief.md 'Application Architecture' Architecture Enforcement: pure logic modules (wave-progress-translator.ts, run-watchdog.ts, wave-runner.ts transition logic) must not import node:child_process or call fetch/apiFetch directly — only HttpRunRepository may.",
      severity: "error",
      from: {
        path: "^apps/agent-runner/src/nwave-invocation/(wave-progress-translator|run-watchdog|wave-runner)\\.ts$",
      },
      to: { path: "^node:child_process$" },
    },
    {
      name: "no-ticket-classification-into-nwave-invocation-or-wrapper-harness",
      comment:
        "ticket-classification is upstream of and independent from invocation; only coupling is the ticket.classification.confirmed event.",
      severity: "error",
      from: { path: "^apps/agent-runner/src/ticket-classification" },
      to: {
        path: "^apps/agent-runner/src/(nwave-invocation|wrapper-harness)",
      },
    },
    {
      name: "no-ticket-classification-into-native-form-routes",
      comment:
        "ADR-0004: ticket-classification must not import apps/api/src/routes/tickets.ts or assume a native-form-specific ticket.created payload shape.",
      severity: "error",
      from: { path: "^apps/agent-runner/src/ticket-classification" },
      to: { path: "^apps/api/src/routes/tickets\\.ts$" },
    },
    {
      name: "no-progress-trust-ux-into-sibling-modules-or-wrapper-harness",
      comment:
        "progress-trust-ux coordinates with nwave-invocation/ticket-classification only via the event bus and shared HTTP contract, never direct import (extends ADR-0004's decoupling rule to a third module).",
      severity: "error",
      from: { path: "^apps/agent-runner/src/progress-trust-ux" },
      to: {
        path: "^apps/agent-runner/src/(nwave-invocation|ticket-classification|wrapper-harness)",
      },
    },
    {
      name: "no-progress-trust-ux-process-signaling",
      comment:
        "ADR-0006: progress-trust-ux must never import node:child_process or the shell_stop tool definition — Pause/Halt never signals a running wave process. This is the structural, CI-checkable proof of the zero-tolerance corruption guarantee.",
      severity: "error",
      from: { path: "^apps/agent-runner/src/progress-trust-ux" },
      to: {
        path: "^(node:child_process|apps/agent-runner/src/tools/shell)",
      },
    },
    {
      name: "no-msig-into-sibling-modules-or-wrapper-harness",
      comment:
        "multi-source-ingestion-governance coordinates with all three sibling modules only via the event bus and shared HTTP contract (extends the one-way decoupling rule to a fourth module).",
      severity: "error",
      from: {
        path: "^apps/agent-runner/src/multi-source-ingestion-governance",
      },
      to: {
        path: "^apps/agent-runner/src/(nwave-invocation|ticket-classification|progress-trust-ux|wrapper-harness)",
      },
    },
    {
      name: "only-trello-cli-board-reader-may-shell-out-to-trello",
      comment:
        "ADR-0008: TrelloCliBoardReader is the only module permitted to import node:child_process or invoke the trello-cli skill within multi-source-ingestion-governance/**.",
      severity: "error",
      from: {
        path: "^apps/agent-runner/src/multi-source-ingestion-governance",
        pathNot:
          "^apps/agent-runner/src/multi-source-ingestion-governance/trello-cli-board-reader\\.ts$",
      },
      to: { path: "^node:child_process$" },
    },
    {
      name: "stuck-run-detector-must-import-shared-run-activity-deriver",
      comment:
        "ADR-0012: stuck-run-detector.ts must import the shared Run Activity Deriver (packages/schemas/src/run-activity.ts) rather than reimplementing staleness computation locally — one shared pure function, parameterized per caller.",
      severity: "error",
      from: {
        path: "^apps/agent-runner/src/multi-source-ingestion-governance/stuck-run-detector\\.ts$",
      },
      to: {
        path: "^apps/agent-runner/src/(nwave-invocation|progress-trust-ux)/(?!.*run-activity).*staleness",
      },
    },
    {
      name: "no-circular-deps-within-nwave-modules",
      comment:
        "Every track's brief.md requires no circular dependencies among its own new components.",
      severity: "error",
      from: {
        path: "^apps/agent-runner/src/(nwave-invocation|ticket-classification|progress-trust-ux|multi-source-ingestion-governance)",
      },
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsConfig: {
      fileName: "apps/agent-runner/tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};

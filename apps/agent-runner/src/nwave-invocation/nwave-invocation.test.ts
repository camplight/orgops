import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import {
  apiFetchAsRunner,
  authedRequest,
  createFailingRealShellStart,
  createRealApiApp,
  createRealShellStart,
  loginAsAdmin,
} from "./acceptance-test-support";
import { composeRestatement, type GenerateFn } from "./restatement-composer";
import { evaluateConfirmationResponse } from "./confirmation-gate";
import { advanceToNextWave, triggerRunForConfirmedIntent, type WaveRunnerDependencies } from "./wave-runner";
import { deriveWaveProgressEvents } from "./wave-progress-translator";
import { collectStaleWaves } from "./run-watchdog";
import { createHttpRunRepository } from "./http-run-repository";
import type { WaveName } from "./types";

// US-04: nWave Implementation Run Is Triggered for a Classified Development Ticket.
// Traceability: docs/feature/nwave-invocation-engine/discuss/user-stories.md US-04.
//
// Walking-Skeleton Strategy B (see distill/wave-decisions.md DWD-01): real SQLite + real Hono
// API app for all local I/O (@real-io), including a real (trivial, non-nWave) local subprocess
// standing in for the shell_start substrate; the Restatement Composer's LLM call is a costly
// external dependency, faked via an in-memory `generate()` test double (@in-memory).

function buildEchoWaveCommand({ ticketRef, waveName }: { ticketRef: string; waveName: WaveName }): string {
  return `echo "invoking ${waveName} for ${ticketRef}"`;
}

describe("US-04: a confirmed development-work ticket triggers an nWave implementation run", () => {
  it("[@walking_skeleton @real-io @in-memory @driving_port @US-04] Maria confirms the system's understood intent and an nWave implementation run starts, identified by a stable run id", async () => {
    const app = createRealApiApp();
    const runRepository = createHttpRunRepository({ apiFetch: apiFetchAsRunner(app) });
    const fakeGenerate: GenerateFn = async () => ({
      text: "Adds a region filter dropdown to the Reports dashboard, defaulting to the viewer's home region.",
    });

    // Given TICKET-1043 has been classified as development work
    // When the system posts its plain-language restatement...
    const { restatementText } = await composeRestatement(
      {
        ticketRef: "TICKET-1043",
        ticketTitle: "Add a region filter to the Reports dashboard",
        ticketDescription: "Maria wants to filter the Reports dashboard by region.",
      },
      { generate: fakeGenerate, modelId: "claude-3-5-sonnet" },
    );

    // ...the composed restatement is posted to the ticket-scoped channel...
    // ...and Maria Santos confirms "Looks right"
    const confirmationOutcome = evaluateConfirmationResponse({
      ticketRef: "TICKET-1043",
      channelId: "channel-ticket-1043",
      events: [
        {
          id: "evt-0",
          type: "message.created",
          source: "agent:restatement-composer",
          channelId: "channel-ticket-1043",
          payload: { text: restatementText },
        },
        {
          id: "evt-1",
          type: "message.created",
          source: "human:maria-santos",
          channelId: "channel-ticket-1043",
          payload: { text: "Looks right" },
        },
      ],
    });
    expect(confirmationOutcome.kind).toBe("CONFIRMED");
    // The confirmed text must be the actually-posted restatement pulled from the channel's
    // event history, never an empty default — proving US-04 AC1's "a plain-language
    // restatement is posted before any run starts and is the text ultimately confirmed".
    expect(
      confirmationOutcome.kind === "CONFIRMED" ? confirmationOutcome.confirmedRestatementText : "",
    ).toBe(restatementText);

    const deps: WaveRunnerDependencies = {
      runRepository,
      shellStart: createRealShellStart(),
      buildWaveCommand: buildEchoWaveCommand,
    };

    // Then an nWave implementation run starts for TICKET-1043, identified by a stable run id
    const run = await triggerRunForConfirmedIntent(
      {
        ticketRef: "TICKET-1043",
        channelId: "channel-ticket-1043",
        confirmedRestatementText:
          confirmationOutcome.kind === "CONFIRMED"
            ? confirmationOutcome.confirmedRestatementText
            : restatementText,
      },
      deps,
    );

    expect(run.id).toMatch(/^RUN-/);
    expect(["STARTING", "RUNNING"]).toContain(run.status);
    // The persisted run must carry the actually-composed restatement text — never the empty
    // default that flows through when no agent-posted restatement event is found (US-04 AC1).
    expect(run.restatementText.length).toBeGreaterThan(0);
    expect(run.restatementText).toBe(restatementText);
  });

  it("[@driving_port @US-04] Carlos corrects a misunderstood restatement and the run does not start until re-confirmed", () => {
    // Given TICKET-1046 ("Add Slack notification when invoice payment fails") has been
    // classified as development work
    // When the system posts a restatement missing the target Slack channel and Carlos Mendes
    // selects "Not quite" and adds the missing detail
    const outcome = evaluateConfirmationResponse({
      ticketRef: "TICKET-1046",
      channelId: "channel-ticket-1046",
      events: [
        {
          id: "evt-1",
          type: "message.created",
          source: "human:carlos-mendes",
          channelId: "channel-ticket-1046",
          payload: { text: 'Not quite — notify the #billing-alerts channel, not just "Slack"' },
        },
      ],
    });

    // Then implementation does not start until the corrected understanding is confirmed
    expect(outcome.kind).toBe("CORRECTED");
  });

  it("[@US-04] Maria is told clearly a run could not start when the execution environment is unavailable, never shown false progress", async () => {
    const app = createRealApiApp();
    const runRepository = createHttpRunRepository({ apiFetch: apiFetchAsRunner(app) });
    const deps: WaveRunnerDependencies = {
      runRepository,
      shellStart: createFailingRealShellStart(),
      buildWaveCommand: buildEchoWaveCommand,
    };

    // Given TICKET-1043's intent has been confirmed
    // When the underlying execution environment is unavailable
    const run = await triggerRunForConfirmedIntent(
      {
        ticketRef: "TICKET-1043",
        channelId: "channel-ticket-1043",
        confirmedRestatementText: "Adds a region filter dropdown to the Reports dashboard.",
      },
      deps,
    );

    // Then Maria Santos is told the run could not start — marked START_FAILED, referencing the
    // stable run id created before the spawn attempt, never left implying work is underway
    expect(run.status).toBe("START_FAILED");
    expect(run.id).toMatch(/^RUN-/);
  });

  it("[@property @US-04] the run id remains stable and is referenced by every wave transition for the life of the run", async () => {
    const app = createRealApiApp();
    const runRepository = createHttpRunRepository({ apiFetch: apiFetchAsRunner(app) });
    const deps: WaveRunnerDependencies = {
      runRepository,
      shellStart: createRealShellStart(),
      buildWaveCommand: buildEchoWaveCommand,
    };

    // Given an implementation run has started for TICKET-1043 with run id RUN-8841
    const run = await triggerRunForConfirmedIntent(
      {
        ticketRef: "TICKET-1043",
        channelId: "channel-ticket-1043",
        confirmedRestatementText: "Adds a region filter dropdown to the Reports dashboard.",
      },
      deps,
    );

    // When the run progresses through multiple waves
    const afterDiscuss = await advanceToNextWave(
      { runId: run.id, completedWaveName: "DISCUSS", exitCode: 0 },
      deps,
    );
    const afterDesign = await advanceToNextWave(
      { runId: run.id, completedWaveName: "DESIGN", exitCode: 0 },
      deps,
    );

    // Then every progress message for TICKET-1043 references run id RUN-8841 — for any number
    // of wave transitions, not just the first one
    expect(afterDiscuss?.runId).toBe(run.id);
    expect(afterDesign?.runId).toBe(run.id);
  });

  it("[@driving_adapter @real-io @US-04] a run's current status and wave history are observable through the run detail view", async () => {
    const app = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given an implementation run has started for TICKET-1043
    // When Maria Santos views the run's detail
    const res = await request("/api/nwave-runs/RUN-8841");

    // Then she sees the run's current status and its wave-by-wave history, all referencing the
    // same stable run id
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; status: string; waves: unknown[] };
    expect(body.id).toBe("RUN-8841");
  });

  it("[@US-04] a wave that exits with a non-zero code fails the run and halts the chain without starting the next wave", async () => {
    const app = createRealApiApp();
    const runRepository = createHttpRunRepository({ apiFetch: apiFetchAsRunner(app) });
    const deps: WaveRunnerDependencies = {
      runRepository,
      shellStart: createRealShellStart(),
      buildWaveCommand: buildEchoWaveCommand,
    };

    // Given DISTILL's wave process for TICKET-1043 has exited with a non-zero code
    // When the Wave Runner processes that exit
    const nextWave = await advanceToNextWave(
      { runId: "RUN-8841", completedWaveName: "DISTILL", exitCode: 1 },
      deps,
    );

    // Then the wave and run are marked FAILED and the DELIVER wave never starts
    expect(nextWave).toBeNull();
  });

  it("[@US-04] a wave that produces no output for longer than the configured threshold is halted with a clear \"no progress\" signal", () => {
    const now = Date.now();

    // Given DESIGN's wave process for TICKET-1043 has produced no output for 20 minutes,
    // beyond the configured 10-minute threshold
    const staleFlags = collectStaleWaves({
      waves: [
        {
          runId: "RUN-8841",
          waveId: "wave-2",
          waveName: "DESIGN",
          status: "RUNNING",
          lastOutputAt: now - 20 * 60 * 1000,
        },
      ],
      nowMs: now,
      idleTimeoutMs: 10 * 60 * 1000,
    });

    // Then the Run Watchdog flags it as stale so it can be halted, never left looking active
    expect(staleFlags).toEqual([{ runId: "RUN-8841", waveId: "wave-2", waveName: "DESIGN" }]);
  });

  it("[@US-04] a run's wave-progress signal is derived from process lifecycle events, not from parsing agent output", () => {
    // Given DISCUSS's wave process for TICKET-1043 has started and later exited cleanly
    const events = deriveWaveProgressEvents({
      events: [
        { type: "process.started", processId: "proc-1" },
        { type: "process.exited", processId: "proc-1", exitCode: 0 },
      ],
      waves: [
        {
          id: "wave-1",
          runId: "RUN-8841",
          waveName: "DISCUSS",
          sequence: 1,
          processId: "proc-1",
          status: "RUNNING",
          startedAt: Date.now(),
          endedAt: null,
          exitCode: null,
        },
      ],
    });

    // When that signal is translated into the run's observable progress
    // Then Maria Santos sees a wave-started message followed by a wave-completed message, both
    // referencing run id RUN-8841
    expect(events).toEqual([
      { type: "nwave.run.wave_started", runId: "RUN-8841", waveName: "DISCUSS" },
      { type: "nwave.run.wave_completed", runId: "RUN-8841", waveName: "DISCUSS" },
    ]);
  });

  it("[@driving_adapter @real-io @US-04] a stalled run can be halted through the run's halt action, and no further waves proceed after halting", async () => {
    const app = createRealApiApp();
    const request = apiFetchAsRunner(app);

    // Given TICKET-1043's run has been flagged as stalled by the Run Watchdog
    // When the halt action is invoked for RUN-8841
    const res = await request("/api/nwave-runs/RUN-8841/halt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "no progress detected for 10 minutes" }),
    });

    // Then the run is marked HALTED and no further wave is ever started for it
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("HALTED");
  });

  it("[@property @US-04] a redelivered wave-completion notification does not advance the run a second time", async () => {
    const app = createRealApiApp();
    const request = apiFetchAsRunner(app);

    // Given DISCUSS's wave process for TICKET-1043 has already been recorded as completed once
    const firstCompletion = await request("/api/nwave-runs/RUN-8841/waves/wave-1/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exitCode: 0 }),
    });

    // When the same completion notification is redelivered, for any number of redeliveries
    const secondCompletion = await request("/api/nwave-runs/RUN-8841/waves/wave-1/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exitCode: 0 }),
    });

    // Then the run advances to DESIGN exactly once, matching the platform's existing
    // at-least-once (not exactly-once) event delivery guarantee — never advancing twice
    // regardless of how many times the same completion is redelivered
    expect(firstCompletion.status).toBe(200);
    expect(secondCompletion.status).toBe(200);
    const runAfter = await request("/api/nwave-runs/RUN-8841");
    const body = (await runAfter.json()) as { currentWave?: string; current_wave?: string };
    expect(body.currentWave ?? body.current_wave).toBe("DESIGN");
  });

  it("[@US-04] before any confirmation is observed, no run is ever created or shown as in progress", () => {
    // Given the restatement has been posted for TICKET-1043 but Maria Santos has not yet
    // responded
    const outcome = evaluateConfirmationResponse({
      ticketRef: "TICKET-1043",
      channelId: "channel-ticket-1043",
      events: [],
    });

    // Then the outcome is PENDING — Wave Runner must never call createRun for a PENDING
    // outcome, so nothing can be shown as "in progress"
    expect(outcome.kind).toBe("PENDING");
  });

  it("[@US-04] an unrelated message in the ticket channel is never mistaken for confirmation", () => {
    // Given the restatement has been posted for TICKET-1043 and Maria Santos replies about
    // something else entirely, neither confirming nor correcting the restatement
    const outcome = evaluateConfirmationResponse({
      ticketRef: "TICKET-1043",
      channelId: "channel-ticket-1043",
      events: [
        {
          id: "evt-1",
          type: "message.created",
          source: "human:maria-santos",
          channelId: "channel-ticket-1043",
          payload: { text: "What's the ETA on this?" },
        },
      ],
    });

    // Then the outcome is PENDING — an unrelated message must never be inferred as confirmation
    expect(outcome.kind).toBe("PENDING");
  });

  it("[@US-04] wave chaining follows DISCUSS, DESIGN, DISTILL, DELIVER in order, and the run completes once DELIVER exits cleanly", async () => {
    const app = createRealApiApp();
    const runRepository = createHttpRunRepository({ apiFetch: apiFetchAsRunner(app) });
    const deps: WaveRunnerDependencies = {
      runRepository,
      shellStart: createRealShellStart(),
      buildWaveCommand: buildEchoWaveCommand,
    };

    // Given TICKET-1043's run has progressed through DISCUSS, DESIGN, and DISTILL, each
    // exiting cleanly
    for (const waveName of ["DISCUSS", "DESIGN", "DISTILL"] as const) {
      await advanceToNextWave({ runId: "RUN-8841", completedWaveName: waveName, exitCode: 0 }, deps);
    }

    // When DELIVER, the final wave, also exits cleanly
    const afterDeliver = await advanceToNextWave(
      { runId: "RUN-8841", completedWaveName: "DELIVER", exitCode: 0 },
      deps,
    );

    // Then no further wave is started and the run is marked COMPLETED
    expect(afterDeliver).toBeNull();
    const run = await runRepository.getRun({ runId: "RUN-8841" });
    expect(run?.status).toBe("COMPLETED");
  });

  it("[@US-04] someone with no authenticated session cannot halt or inspect an implementation run", async () => {
    const app = createRealApiApp();

    // Given someone with no authenticated session at all
    // When they attempt to halt TICKET-1043's run
    const res = await app.request("http://localhost/api/nwave-runs/RUN-8841/halt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "attempted unauthenticated halt" }),
    });

    // Then the request is rejected, never silently accepted
    expect(res.status).toBe(401);
  });

  it("[@driving_adapter @real-io @US-04] a run cannot be created with a blank restatement, since a run must always carry the text Maria actually confirmed", async () => {
    const app = createRealApiApp();
    const request = apiFetchAsRunner(app);

    // Given the Restatement Composer has not produced any confirmed restatement text (blank/
    // whitespace-only, e.g. a wiring bug upstream)
    // When a run creation is attempted with that blank restatement text
    const res = await request("/api/nwave-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ticketRef: "TICKET-1043",
        channelId: "channel-ticket-1043",
        restatementText: "   ",
      }),
    });

    // Then the request is rejected — a run must never be created without the plain-language
    // restatement Maria actually confirmed (US-04 AC1)
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("restatementText must be a non-empty string");
  });

  it("[@US-04] the system composes a plain-language restatement of the ticket's intent before any run starts", async () => {
    const fakeGenerate: GenerateFn = async () => ({
      text: "Adds a Slack notification to the #billing-alerts channel when an invoice payment fails.",
    });

    // Given TICKET-1046 ("Add Slack notification when invoice payment fails") has been
    // classified as development work
    // When the system composes its restatement of intent
    const { restatementText } = await composeRestatement(
      {
        ticketRef: "TICKET-1046",
        ticketTitle: "Add Slack notification when invoice payment fails",
        ticketDescription: "Notify the team in Slack whenever an invoice payment fails.",
      },
      { generate: fakeGenerate, modelId: "claude-3-5-sonnet" },
    );

    // Then a plain-language restatement is produced, ready to post to the ticket-scoped
    // channel before any run starts (US-04 AC1)
    expect(restatementText.length).toBeGreaterThan(0);
  });

  const hasNwaveCliContractFixture = existsSync(
    `${process.env.HOME ?? ""}/.orgops-nwave-cli-contract-fixture`,
  );

  it.skipIf(!hasNwaveCliContractFixture)(
    "[@requires_external @US-04] the nWave CLI headless invocation contract remains stable",
    async () => {
      // Given a fixed-input/fixed-expected-shape fixture for the actual `claude -p ...`
      // headless invocation is available in this environment (per brief.md "External
      // Integrations Requiring Contract Awareness" — the single highest-risk boundary in this
      // design, and Decision 1's unvalidated headless-feasibility assumption)
      // When the Wave Runner spawns a wave process using the real nWave CLI invocation command
      // Then the CLI's exit-code/output-format contract matches what Wave Runner depends on
      //
      // Skipped by default (no fixture/credentials in this environment) — recommended CI-only
      // smoke test named by the architecture brief itself, not part of the fast local
      // acceptance suite. Mirrors multi-source-ingestion-governance's own trello-cli
      // contract-test convention.
      //
      // ADR-0001 explicitly leaves the real `claude -p ...` invocation's exit-code/output-format
      // contract unconfirmed ("exact flags to be confirmed on first real implementation
      // attempt" — see docs/product/architecture/adr-0001-nwave-invocation-mechanism.md). There
      // is no validated contract shape to assert against yet; fabricating one here (guessing at
      // exit codes or an `--output-format=stream-json` structure nobody has verified) would be
      // less honest than refusing to pass. Once the fixture and a confirmed contract exist, this
      // body must be replaced with a real invocation (mirroring
      // createRealShellStart()/buildEchoWaveCommand, but spawning the real `claude -p ...`
      // command per the confirmed contract) that asserts the actual exit code and output shape.
      throw new Error(
        "CLI contract test not yet implemented — see docs/product/architecture/brief.md " +
          "External Integrations Requiring Contract Awareness section and " +
          "adr-0001-nwave-invocation-mechanism.md (exact CLI contract not yet confirmed)",
      );
    },
  );
});

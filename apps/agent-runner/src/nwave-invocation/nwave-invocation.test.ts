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
    // ...and the reason references the actual wave that failed to start and the real spawn
    // failure detail, never a blank/generic message (US-04 AC5)
    expect(run.failureReason).toContain("DISCUSS");
    expect(run.failureReason).toContain("execution environment is unavailable");
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

    // Given DISCUSS's wave process for TICKET-1043 (RUN-8841's fixture-seeded running wave —
    // see acceptance-test-support.ts's seedNwaveRunFixture) has exited with a non-zero code.
    // (Regression note: this scenario previously asserted against a "DISTILL" wave name that
    // does not exist in the seeded fixture, so `findRunningWave` returned undefined and the
    // assertion below passed vacuously via the run/wave-not-found guard, never actually
    // exercising `recordWaveFailure` — a Stryker mutation-testing run surfaced this as multiple
    // "no coverage" mutants in wave-runner.ts's failure-recording path.)
    // When the Wave Runner processes that exit
    const nextWave = await advanceToNextWave(
      { runId: "RUN-8841", completedWaveName: "DISCUSS", exitCode: 1 },
      deps,
    );

    // Then the wave and run are marked FAILED and the DELIVER wave never starts
    expect(nextWave).toBeNull();
    const run = await runRepository.getRun({ runId: "RUN-8841" });
    expect(run?.status).toBe("FAILED");
    expect(run?.failureReason).toContain("DISCUSS");
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

  it("[@US-04] a submitter's reply is recognized as confirmation even with incidental surrounding whitespace", () => {
    // Given the submitter's reply to the restatement carries incidental leading/trailing
    // whitespace (e.g. a client that pads message text)
    const outcome = evaluateConfirmationResponse({
      ticketRef: "TICKET-1043",
      channelId: "channel-ticket-1043",
      events: [
        {
          id: "evt-1",
          type: "message.created",
          source: "human:maria-santos",
          channelId: "channel-ticket-1043",
          payload: { text: "  Looks right  " },
        },
      ],
    });

    // Then the surrounding whitespace never prevents recognizing the confirmation
    expect(outcome.kind).toBe("CONFIRMED");
  });

  it("[@US-04] a message with no usable text — missing text field, a non-string text value, or no payload at all — is never mistaken for a reply", () => {
    // Given the ticket channel contains message events whose payload carries no usable text
    // (malformed upstream events, never a valid submitter reply)
    const outcomeNoTextField = evaluateConfirmationResponse({
      ticketRef: "TICKET-1043",
      channelId: "channel-ticket-1043",
      events: [
        {
          id: "evt-1",
          type: "message.created",
          source: "human:maria-santos",
          channelId: "channel-ticket-1043",
          payload: { unrelatedField: true },
        },
      ],
    });
    const outcomeNonStringText = evaluateConfirmationResponse({
      ticketRef: "TICKET-1043",
      channelId: "channel-ticket-1043",
      events: [
        {
          id: "evt-2",
          type: "message.created",
          source: "human:maria-santos",
          channelId: "channel-ticket-1043",
          payload: { text: 12345 },
        },
      ],
    });
    const outcomeNullPayload = evaluateConfirmationResponse({
      ticketRef: "TICKET-1043",
      channelId: "channel-ticket-1043",
      events: [
        {
          id: "evt-3",
          type: "message.created",
          source: "human:maria-santos",
          channelId: "channel-ticket-1043",
          payload: null,
        },
      ],
    });

    // Then none of them is ever mistaken for confirmation or correction — the outcome stays
    // PENDING in every case
    expect(outcomeNoTextField.kind).toBe("PENDING");
    expect(outcomeNonStringText.kind).toBe("PENDING");
    expect(outcomeNullPayload.kind).toBe("PENDING");
  });

  it("[@US-04] the latest submitter reply is chosen by when it actually happened, not by its position in the event batch, and an agent's own message is never mistaken for the submitter's reply even when it is the most recent event overall", () => {
    // Given the submitter corrected the restatement, then later confirmed it ("Looks right") —
    // but the events arrive out of chronological order, and the agent posts again afterward
    // (an even later event that must never count as the submitter's reply)
    const outcome = evaluateConfirmationResponse({
      ticketRef: "TICKET-1043",
      channelId: "channel-ticket-1043",
      events: [
        {
          id: "evt-agent-followup",
          type: "message.created",
          source: "agent:restatement-composer",
          channelId: "channel-ticket-1043",
          payload: { text: "Starting implementation shortly." },
          createdAt: 3000,
        },
        {
          id: "evt-confirm",
          type: "message.created",
          source: "human:maria-santos",
          channelId: "channel-ticket-1043",
          payload: { text: "Looks right" },
          createdAt: 2000,
        },
        {
          id: "evt-correction",
          type: "message.created",
          source: "human:maria-santos",
          channelId: "channel-ticket-1043",
          payload: { text: "Not quite" },
          createdAt: 1000,
        },
      ],
    });

    // Then the outcome reflects the chronologically-latest submitter reply (CONFIRMED) — never
    // the earlier correction, and never the agent's later, unrelated message
    expect(outcome.kind).toBe("CONFIRMED");
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
    // ...and each recorded wave carries its correct 1-based position in the chain — DISCUSS
    // first, DELIVER last — never an out-of-order or default sequence number
    expect(run?.waves.map((wave) => wave.waveName)).toEqual([
      "DISCUSS",
      "DESIGN",
      "DISTILL",
      "DELIVER",
    ]);
    expect(run?.waves.map((wave) => wave.sequence)).toEqual([1, 2, 3, 4]);
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

  it("[@US-04] the composed prompt instructs the model to restate for confirm-or-correct without adding commentary, carries the ticket's actual details, and the model's response is trimmed before becoming the confirmed text", async () => {
    const receivedCalls: Array<{
      modelId: string;
      messages: Array<{ role: string; content: string }>;
    }> = [];
    const spyGenerate: GenerateFn = async (modelId, messages) => {
      receivedCalls.push({ modelId, messages });
      return { text: "  Adds a region filter to the Reports dashboard.  " };
    };

    // When the Restatement Composer composes intent for a ticket
    const { restatementText } = await composeRestatement(
      {
        ticketRef: "TICKET-1043",
        ticketTitle: "Add a region filter to the Reports dashboard",
        ticketDescription: "Maria wants to filter the Reports dashboard by region.",
      },
      { generate: spyGenerate, modelId: "claude-3-5-sonnet" },
    );

    // Then it calls the LLM with the confirmed model id and exactly a system + user message pair
    expect(receivedCalls).toHaveLength(1);
    expect(receivedCalls[0]?.modelId).toBe("claude-3-5-sonnet");
    const messages = receivedCalls[0]?.messages ?? [];
    expect(messages).toHaveLength(2);

    // ...the system message instructs the model to restate for confirm-or-correct, without
    // implementation detail — the actual business instruction given to the model, not just its
    // wiring (US-04 AC1)
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("restate");
    expect(messages[0]?.content).toContain("confirm or correct");
    expect(messages[0]?.content).toContain("no implementation detail");

    // ...the user message carries the actual ticket reference, title, and description — never
    // a placeholder or empty prompt
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("TICKET-1043");
    expect(messages[1]?.content).toContain("Add a region filter to the Reports dashboard");
    expect(messages[1]?.content).toContain(
      "Maria wants to filter the Reports dashboard by region.",
    );

    // ...and the model's response is trimmed before becoming the confirmed restatement text
    expect(restatementText).toBe("Adds a region filter to the Reports dashboard.");
  });

  it("[@US-04] only RUNNING waves that have exceeded the idle timeout are flagged stale — waves that are not running, have not yet produced output, or are still within the timeout, are left alone", () => {
    const now = Date.now();
    const idleTimeoutMs = 10 * 60 * 1000;

    const staleFlags = collectStaleWaves({
      waves: [
        // Stale: RUNNING, idle well beyond the timeout
        {
          runId: "RUN-8841",
          waveId: "wave-stale",
          waveName: "DESIGN",
          status: "RUNNING",
          lastOutputAt: now - 20 * 60 * 1000,
        },
        // Not stale: RUNNING, but still within the timeout
        {
          runId: "RUN-8841",
          waveId: "wave-fresh",
          waveName: "DISCUSS",
          status: "RUNNING",
          lastOutputAt: now - 60 * 1000,
        },
        // Not stale: RUNNING, exactly at the timeout boundary — must be strictly greater than
        {
          runId: "RUN-8841",
          waveId: "wave-boundary",
          waveName: "DISTILL",
          status: "RUNNING",
          lastOutputAt: now - idleTimeoutMs,
        },
        // Not stale: RUNNING but has not produced any output yet
        {
          runId: "RUN-8841",
          waveId: "wave-no-output-yet",
          waveName: "DELIVER",
          status: "RUNNING",
          lastOutputAt: null,
        },
        // Not stale: already finished, even though its last recorded output looks very old
        {
          runId: "RUN-8841",
          waveId: "wave-completed",
          waveName: "DESIGN",
          status: "COMPLETED",
          lastOutputAt: now - 60 * 60 * 1000,
        },
      ],
      nowMs: now,
      idleTimeoutMs,
    });

    // Then only the genuinely stale wave is flagged — every other wave is left alone
    expect(staleFlags).toEqual([{ runId: "RUN-8841", waveId: "wave-stale", waveName: "DESIGN" }]);
  });

  it("[@US-04] a wave process's non-zero exit derives a wave-failed event (never wave-completed), and non-terminal or unmatched lifecycle events produce no event at all", () => {
    const events = deriveWaveProgressEvents({
      events: [
        { type: "process.started", processId: "proc-1" },
        // A non-terminal lifecycle event must never itself produce a progress event
        { type: "process.output", processId: "proc-1" },
        // An event for a process that belongs to no tracked wave must be silently ignored
        { type: "process.exited", processId: "proc-unknown", exitCode: 0 },
        { type: "process.exited", processId: "proc-1", exitCode: 1 },
      ],
      waves: [
        {
          id: "wave-1",
          runId: "RUN-8841",
          waveName: "DESIGN",
          sequence: 2,
          processId: "proc-1",
          status: "RUNNING",
          startedAt: Date.now(),
          endedAt: null,
          exitCode: null,
        },
      ],
    });

    // Then only the started and failed events are derived, in that order, carrying the actual
    // exit code — never a wave-completed event for a non-zero exit, and never an event for the
    // output or unmatched-process notifications
    expect(events).toEqual([
      { type: "nwave.run.wave_started", runId: "RUN-8841", waveName: "DESIGN" },
      { type: "nwave.run.wave_failed", runId: "RUN-8841", waveName: "DESIGN", exitCode: 1 },
    ]);
  });

  it("[@US-04] lifecycle events are translated in true chronological order, not array position, and each is attributed to the wave whose process actually produced it", () => {
    const events = deriveWaveProgressEvents({
      events: [
        // Deliberately out of chronological order
        { type: "process.exited", processId: "proc-design", exitCode: 0, createdAt: 4000 },
        { type: "process.started", processId: "proc-discuss", createdAt: 1000 },
        { type: "process.started", processId: "proc-design", createdAt: 3000 },
        { type: "process.exited", processId: "proc-discuss", exitCode: 0, createdAt: 2000 },
      ],
      waves: [
        {
          id: "wave-1",
          runId: "RUN-8841",
          waveName: "DISCUSS",
          sequence: 1,
          processId: "proc-discuss",
          status: "RUNNING",
          startedAt: Date.now(),
          endedAt: null,
          exitCode: null,
        },
        {
          id: "wave-2",
          runId: "RUN-8841",
          waveName: "DESIGN",
          sequence: 2,
          processId: "proc-design",
          status: "RUNNING",
          startedAt: Date.now(),
          endedAt: null,
          exitCode: null,
        },
      ],
    });

    // Then events are derived in true chronological order (DISCUSS starts, DISCUSS completes,
    // DESIGN starts, DESIGN completes) — never the array's original scrambled order — and each
    // event references the wave that actually matches its process id, never the wrong wave
    expect(events).toEqual([
      { type: "nwave.run.wave_started", runId: "RUN-8841", waveName: "DISCUSS" },
      { type: "nwave.run.wave_completed", runId: "RUN-8841", waveName: "DISCUSS" },
      { type: "nwave.run.wave_started", runId: "RUN-8841", waveName: "DESIGN" },
      { type: "nwave.run.wave_completed", runId: "RUN-8841", waveName: "DESIGN" },
    ]);
  });

  it("[@US-04] a wave-completion notification for a run that does not exist, or that names a wave which is not currently running for that run, is safely ignored — never crashing and never advancing anything", async () => {
    const app = createRealApiApp();
    const runRepository = createHttpRunRepository({ apiFetch: apiFetchAsRunner(app) });
    const deps: WaveRunnerDependencies = {
      runRepository,
      shellStart: createRealShellStart(),
      buildWaveCommand: buildEchoWaveCommand,
    };

    // Given a run id that was never created
    // When a wave-completion notification arrives for it
    const forUnknownRun = await advanceToNextWave(
      { runId: "RUN-DOES-NOT-EXIST", completedWaveName: "DISCUSS", exitCode: 0 },
      deps,
    );

    // Given RUN-8841's only recorded wave is DISCUSS, currently RUNNING (per the seeded fixture)
    // When a completion notification arrives for a wave name that is not the one actually
    // running (e.g. a stale/duplicate notification for a wave that already moved on)
    const forMismatchedWaveName = await advanceToNextWave(
      { runId: "RUN-8841", completedWaveName: "DISTILL", exitCode: 0 },
      deps,
    );

    // Then neither notification is ever recorded or advances the run — both are silently ignored
    expect(forUnknownRun).toBeNull();
    expect(forMismatchedWaveName).toBeNull();
    const run = await runRepository.getRun({ runId: "RUN-8841" });
    expect(run?.status).toBe("RUNNING");
    expect(run?.currentWave).toBe("DISCUSS");
  });

  it("[@US-04] looking up a run that does not exist returns null rather than throwing", async () => {
    const app = createRealApiApp();
    const runRepository = createHttpRunRepository({ apiFetch: apiFetchAsRunner(app) });

    // Given no run has ever been created with this id
    // When the Wave Runner (or any caller) looks it up
    const run = await runRepository.getRun({ runId: "RUN-DOES-NOT-EXIST" });

    // Then the repository reports it as absent (null), never throwing or fabricating a run
    expect(run).toBeNull();
  });

  it("[@US-04] the repository surfaces the API's error status and body when a request is rejected, rather than silently returning an empty result", async () => {
    const app = createRealApiApp();
    const runRepository = createHttpRunRepository({ apiFetch: apiFetchAsRunner(app) });

    // Given no run exists with this id
    // When the Wave Runner tries to record a wave-started notification against it
    const attempt = runRepository.recordWaveStarted({
      runId: "RUN-DOES-NOT-EXIST",
      waveName: "DISCUSS",
      sequence: 1,
      processId: "proc-x",
    });

    // Then the repository surfaces a clear, actionable error — the failing operation's name and
    // the actual HTTP status — never silently swallowing the failure or returning an empty result
    await expect(attempt).rejects.toThrow(/recordWaveStarted failed with status 404/);
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

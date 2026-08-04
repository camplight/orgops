import { describe, expect, it } from "vitest";
import {
  addHumanToGovernanceTeam,
  apiFetchAsRunner,
  authedRequest,
  createHumanFixture,
  createRealApiApp,
  loginAsAdmin,
} from "./acceptance-test-support";
import { classifyTicketContent, type GenerateFn } from "./classifier";
import { classifyTicketIfPending } from "./classification-orchestrator";
import { createHttpTicketRepository } from "./http-ticket-repository";
import type { ClassificationResult } from "./types";

// US-01/US-02/US-03: Ticket Classification.
// Traceability: docs/feature/ticket-classification/discuss/user-stories.md.
//
// Walking-Skeleton Strategy B (see distill/wave-decisions.md DWD-01): real SQLite + real Hono
// API app for all local I/O (@real-io), including the real /api/tickets* driving ports; the
// Classifier's LLM call is a costly external dependency, faked via an in-memory `generate()`
// test double (@in-memory) — mirrors both sibling tracks (nwave-invocation-engine,
// multi-source-ingestion-governance) exactly.
//
// Mandate 5 (one test at a time): only the first scenario below is enabled (`it`); every other
// scenario is `it.skip` until the prior one reaches real GREEN. The enabled scenario is expected
// to fail today against a 500 from POST /api/tickets's "not implemented" throw (via Hono's
// onError handler) — a business-logic-shaped RED, not an import/wiring error.

const CLASSIFIER_MODEL_ID = "claude-3-5-sonnet";

function makeFakeGenerate(result: ClassificationResult, rationale: string): GenerateFn {
  return async () => ({ text: JSON.stringify({ result, rationale }) });
}

function makeUnparseableGenerate(rawText: string): GenerateFn {
  return async () => ({ text: rawText });
}

function makeRejectingGenerate(reason: string): GenerateFn {
  return async () => {
    throw new Error(reason);
  };
}

type AuthedRequest = ReturnType<typeof authedRequest>;

type SubmitTicketInput = {
  title?: string;
  description?: string;
  idempotencyKey?: string;
  // Additive fields for non-native sources (ADR-0009 / brief.md Data Model), optional so
  // native-form submissions never need to supply them.
  source?: string;
  sourceRef?: string;
  submitterHumanId?: string;
};

async function submitTicket(
  request: AuthedRequest,
  input: SubmitTicketInput,
): Promise<{ status: number; body: any }> {
  const res = await request("/api/tickets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function readTicket(request: AuthedRequest, ticketId: string): Promise<any> {
  const res = await request(`/api/tickets/${ticketId}`);
  return res.json();
}

async function classifyWithFakeLlm(
  app: ReturnType<typeof createRealApiApp>["app"],
  ticket: { id: string; title: string; description: string | null; isLowDetail: boolean },
  generate: GenerateFn,
): Promise<any> {
  const repository = createHttpTicketRepository({ apiFetch: apiFetchAsRunner(app) });
  const classify = (classifierInput: {
    ticketTitle: string;
    ticketDescription: string | null;
    isLowDetail: boolean;
  }) => classifyTicketContent(classifierInput, { generate, modelId: CLASSIFIER_MODEL_ID });
  return classifyTicketIfPending(
    {
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      ticketDescription: ticket.description,
      isLowDetail: ticket.isLowDetail,
    },
    { repository, classify },
  );
}

describe("US-01/US-02/US-03: ticket classification", () => {
  it("[@walking_skeleton @real-io @in-memory @driving_port @US-01 @US-02] Maria submits a ticket and sees it classified as development work with a rationale", async () => {
    const { app } = createRealApiApp();
    const cookie = await loginAsAdmin(app); // stands in for Maria Santos (no second-human fixture needed for this scenario)
    const request = authedRequest(app, cookie);

    // Given Maria Santos submits a ticket describing a clear, testable bug
    const { status, body: created } = await submitTicket(request, {
      title: "Export to CSV button throws 500 error on Safari",
      description: "Clicking Export to CSV on the Reports dashboard in Safari throws a 500.",
    });
    expect(status).toBe(201);

    // When the classification step runs
    await classifyWithFakeLlm(
      app,
      created,
      makeFakeGenerate(
        "DEVELOPMENT_WORK",
        "Clear bug report with reproduction steps — testable code-level outcome.",
      ),
    );

    // Then Maria sees the ticket classified as development work, with a stated rationale
    const readBody = await readTicket(request, created.id);
    expect(readBody.classificationResult).toBe("DEVELOPMENT_WORK");
    expect(readBody.classificationRationale).toContain("bug report");
  });

  it.skip("[@walking_skeleton @real-io @driving_port @US-03] Devon overrides a misclassified ticket and implementation becomes unblocked", async () => {
    const { app } = createRealApiApp();
    const adminCookie = await loginAsAdmin(app);
    const devon = await createHumanFixture(app, adminCookie, { username: "devon-park" });
    const devonRequest = authedRequest(app, devon.cookie);

    // Given TICKET-1042 (Devon's bug report) was classified as NOT DEVELOPMENT WORK by mistake
    const { body: created } = await submitTicket(devonRequest, {
      title: "Nightly sync silently drops records over 10k rows",
      description: "The overnight sync job stops emitting rows past 10,000 without an error.",
    });
    await classifyWithFakeLlm(
      app,
      created,
      makeFakeGenerate(
        "NOT_DEVELOPMENT_WORK",
        "Classifier missed the technical detail buried in the description.",
      ),
    );
    expect((await readTicket(devonRequest, created.id)).classificationResult).toBe(
      "NOT_DEVELOPMENT_WORK",
    );

    // When Devon Park (the ticket's submitter) selects "Override: this is development work"
    const overrideRes = await devonRequest(`/api/tickets/${created.id}/override`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toResult: "DEVELOPMENT_WORK" }),
    });
    expect(overrideRes.status).toBe(200);

    // Then the classification is updated to DEVELOPMENT WORK, unblocking the implementation
    // trigger step (US-04) — observable both on the ticket record and in the audit history
    const readBody = await readTicket(devonRequest, created.id);
    expect(readBody.classificationResult).toBe("DEVELOPMENT_WORK");

    const historyRes = await devonRequest(`/api/tickets/${created.id}/classification-history`);
    const history = (await historyRes.json()) as any[];
    const overrideEntry = history.find((entry) => entry.eventType === "OVERRIDE");
    expect(overrideEntry.fromResult).toBe("NOT_DEVELOPMENT_WORK");
    expect(overrideEntry.toResult).toBe("DEVELOPMENT_WORK");
    expect(overrideEntry.actorId).toBe(devon.id);
  });

  it("[@US-01] A ticket with no description is still accepted and flagged as low-detail", async () => {
    const { app } = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given Devon Park submits a ticket with only a title
    const { status, body: created } = await submitTicket(request, { title: "Export CSV bug" });

    // Then the ticket is created successfully and flagged as low-detail
    expect(status).toBe(201);
    expect(created.isLowDetail).toBe(true);
  });

  it("[@US-01] A ticket submission without a title is rejected", async () => {
    const { app } = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given Carlos Mendes fills out the ticket form but leaves the title blank
    // When he submits the form
    const { status, body } = await submitTicket(request, { title: "" });

    // Then the submission is rejected
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  it("[@US-01] Duplicate submission with the same idempotency key does not create a second ticket record", async () => {
    const { app } = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given Carlos Mendes double-clicks "Submit Ticket", sending the same request twice
    const submission = {
      title: "Add filter by region to Reports dashboard",
      description: "Region filter, please.",
      idempotencyKey: "carlos-submit-2026-08-04-001",
    };
    const first = await submitTicket(request, submission);
    const second = await submitTicket(request, submission);

    // Then only one ticket record exists
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    const listRes = await request("/api/tickets");
    const list = (await listRes.json()) as any[];
    expect(list.filter((ticket) => ticket.id === first.body.id)).toHaveLength(1);
  });

  it("[@US-01] Submitted tickets are visible in the submitter's ticket dashboard list", async () => {
    const { app } = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given Maria Santos has submitted TICKET-1043
    const { body: created } = await submitTicket(request, {
      title: "Add filter by region to Reports dashboard",
      description: "Region filter, please.",
    });

    // When she navigates to the OrgOps ticket dashboard
    const listRes = await request("/api/tickets");
    const list = (await listRes.json()) as any[];

    // Then TICKET-1043 appears in her list of submitted tickets
    expect(list.map((ticket) => ticket.id)).toContain(created.id);
  });

  it("[@real-io @adapter-integration @US-11] A Trello-sourced ticket reuses the native intake endpoint and is indistinguishable downstream (ADR-0009)", async () => {
    const { app } = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given a Trello card is ingested via the same POST /api/tickets endpoint the native form uses
    const { status, body: created } = await submitTicket(request, {
      title: "Add filter by region to Reports dashboard",
      description: "Region filter, please.",
      source: "TRELLO",
      sourceRef: "card-1043",
      submitterHumanId: "maria-santos",
    });

    // Then a real tickets row is created in the TICKET-{n} format, classified identically to a
    // native-form ticket by every downstream consumer
    expect(status).toBe(201);
    expect(created.id).toMatch(/^TICKET-\d+$/);
    expect(created.source).toBe("TRELLO");
  });

  it("[@US-02] A content-only ticket is classified away from development work, with a routing suggestion", async () => {
    const { app } = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given Maria Santos's ticket asks only for a copy change
    const { body: created } = await submitTicket(request, {
      title: "Update Q3 pricing page copy",
      description: "Please refresh the pricing page copy for Q3.",
    });

    // When the classification step runs
    await classifyWithFakeLlm(
      app,
      created,
      makeFakeGenerate(
        "NOT_DEVELOPMENT_WORK",
        "Content-only language detected — no testable code-level outcome. Route to marketing.",
      ),
    );

    // Then the ticket is classified away from development work, with a rationale that routes her
    // to the right team
    const readBody = await readTicket(request, created.id);
    expect(readBody.classificationResult).toBe("NOT_DEVELOPMENT_WORK");
    expect(readBody.classificationRationale.toLowerCase()).toContain("route");
  });

  it("[@US-02] An ambiguous ticket produces a low-confidence result and does not unblock implementation", async () => {
    const { app } = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given Devon Park's ticket is genuinely ambiguous — could be an investigation or a code fix
    const { body: created } = await submitTicket(request, {
      title: "Investigate why nightly sync job is 40 min slower this week",
      description: "Not sure yet if this needs code changes or just infra tuning.",
    });

    // When the classification step runs
    await classifyWithFakeLlm(
      app,
      created,
      makeFakeGenerate("LOW_CONFIDENCE", "Ambiguous — could be investigation or a code fix."),
    );

    // Then the result is flagged for human confirmation, and implementation is never auto-triggered
    const readBody = await readTicket(request, created.id);
    expect(readBody.classificationResult).toBe("LOW_CONFIDENCE");

    const historyRes = await request(`/api/tickets/${created.id}/classification-history`);
    const history = (await historyRes.json()) as any[];
    expect(history.every((entry) => entry.eventType !== "CONFIRMED")).toBe(true);
  });

  it.skip("[@property @US-02] LOW CONFIDENCE and NOT DEVELOPMENT WORK results never unblock implementation, regardless of rationale content", async () => {
    const nonTriggeringResults: ClassificationResult[] = ["LOW_CONFIDENCE", "NOT_DEVELOPMENT_WORK"];

    for (const result of nonTriggeringResults) {
      const { app } = createRealApiApp();
      const cookie = await loginAsAdmin(app);
      const request = authedRequest(app, cookie);

      const { body: created } = await submitTicket(request, {
        title: `Ticket that should never confirm (${result})`,
        description: "Arbitrary content — the property under test is the gate, not the content.",
      });

      await classifyWithFakeLlm(app, created, makeFakeGenerate(result, "Arbitrary rationale."));

      const readBody = await readTicket(request, created.id);
      expect(readBody.classificationResult).toBe(result);
      // For any classification result other than DEVELOPMENT_WORK, the ticket must never reach a
      // state that would unblock nwave-invocation-engine's US-04 trigger.
      expect(readBody.classificationResult).not.toBe("DEVELOPMENT_WORK");
    }
  });

  it.skip("[@US-02] Classification failure (LLM error) is surfaced, never silently left pending", async () => {
    const { app } = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given Maria Santos has submitted a ticket
    const { body: created } = await submitTicket(request, {
      title: "Something is broken on checkout",
      description: "Not sure what, but customers are complaining.",
    });

    // When the classification step encounters an internal error and cannot produce a result
    await classifyWithFakeLlm(
      app,
      created,
      makeRejectingGenerate("LLM provider timed out after 30s"),
    );

    // Then Maria is shown that classification failed and what happens next — never silent
    const readBody = await readTicket(request, created.id);
    expect(readBody.classificationStatus).toBe("FAILED");
    expect(readBody.classificationFailureReason).toContain("timed out");
  });

  it.skip("[@US-02] Classifier returns an unparseable response — treated identically to an LLM failure, never coerced", async () => {
    const { app } = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    const { body: created } = await submitTicket(request, {
      title: "Something is broken on checkout",
      description: "Not sure what, but customers are complaining.",
    });

    // When the Classifier's response is not valid JSON / not one of the three enum values
    await classifyWithFakeLlm(app, created, makeUnparseableGenerate("I think this is probably a bug?"));

    // Then the ticket is surfaced as a classification failure, never silently defaulted to a
    // guessed result
    const readBody = await readTicket(request, created.id);
    expect(readBody.classificationStatus).toBe("FAILED");
    expect(["DEVELOPMENT_WORK", "NOT_DEVELOPMENT_WORK", "LOW_CONFIDENCE"]).not.toContain(
      readBody.classificationResult,
    );
  });

  it.skip("[@US-02] A redelivered ticket.created for an already-classified ticket is a no-op", async () => {
    const { app } = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    const { body: created } = await submitTicket(request, {
      title: "Export to CSV button throws 500 error on Safari",
      description: "Clicking Export to CSV in Safari throws a 500.",
    });

    // Given the ticket has already been classified once
    await classifyWithFakeLlm(
      app,
      created,
      makeFakeGenerate("DEVELOPMENT_WORK", "Clear, testable bug report."),
    );
    const beforeHistory = (await (
      await request(`/api/tickets/${created.id}/classification-history`)
    ).json()) as any[];

    // When the at-least-once event bus redelivers ticket.created for the same ticket
    await classifyWithFakeLlm(
      app,
      created,
      makeFakeGenerate("NOT_DEVELOPMENT_WORK", "This should never be recorded."),
    );

    // Then the redelivery is a no-op: no second audit row, original result unchanged
    const afterHistory = (await (
      await request(`/api/tickets/${created.id}/classification-history`)
    ).json()) as any[];
    expect(afterHistory).toHaveLength(beforeHistory.length);
    expect((await readTicket(request, created.id)).classificationResult).toBe("DEVELOPMENT_WORK");
  });

  it.skip("[@US-03] Override is rejected for a human who is neither the submitter nor a governance-team member", async () => {
    const { app } = createRealApiApp();
    const adminCookie = await loginAsAdmin(app);
    const maria = await createHumanFixture(app, adminCookie, { username: "maria-santos" });
    const stranger = await createHumanFixture(app, adminCookie, { username: "unrelated-human" });
    const mariaRequest = authedRequest(app, maria.cookie);
    const strangerRequest = authedRequest(app, stranger.cookie);

    const { body: created } = await submitTicket(mariaRequest, {
      title: "Update Q3 pricing page copy",
      description: "Please refresh the pricing page copy for Q3.",
    });
    await classifyWithFakeLlm(
      app,
      created,
      makeFakeGenerate("NOT_DEVELOPMENT_WORK", "Content-only language detected."),
    );

    // When a human who is neither the submitter nor governance attempts to override
    const overrideRes = await strangerRequest(`/api/tickets/${created.id}/override`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toResult: "DEVELOPMENT_WORK" }),
    });

    // Then the request is rejected and nothing is written
    expect(overrideRes.status).toBe(403);
    const history = (await (
      await mariaRequest(`/api/tickets/${created.id}/classification-history`)
    ).json()) as any[];
    expect(history.every((entry) => entry.eventType !== "OVERRIDE")).toBe(true);
  });

  it.skip("[@US-03] Priya (a governance-team member who is not the submitter) can override, and the override is audited with her identity", async () => {
    const { app, db } = createRealApiApp();
    const adminCookie = await loginAsAdmin(app);
    const devon = await createHumanFixture(app, adminCookie, { username: "devon-park" });
    const priya = await createHumanFixture(app, adminCookie, { username: "priya-nair" });
    addHumanToGovernanceTeam(db, priya.id);
    const devonRequest = authedRequest(app, devon.cookie);
    const priyaRequest = authedRequest(app, priya.cookie);

    const { body: created } = await submitTicket(devonRequest, {
      title: "Export to CSV button throws 500 error on Safari",
      description: "Clicking Export to CSV in Safari throws a 500.",
    });
    await classifyWithFakeLlm(
      app,
      created,
      makeFakeGenerate("NOT_DEVELOPMENT_WORK", "Classifier missed the technical detail."),
    );

    // When Priya Nair, a governance-team member (not the submitter), overrides the classification
    const overrideRes = await priyaRequest(`/api/tickets/${created.id}/override`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toResult: "DEVELOPMENT_WORK" }),
    });

    // Then the override succeeds and the audit trail records Priya as the actor
    expect(overrideRes.status).toBe(200);
    const history = (await (
      await priyaRequest(`/api/tickets/${created.id}/classification-history`)
    ).json()) as any[];
    const overrideEntry = history.find((entry: any) => entry.eventType === "OVERRIDE");
    expect(overrideEntry.actorId).toBe(priya.id);
  });

  it.skip("[@US-03] The override audit trail records who, when, from, and to, visible to governance review", async () => {
    const { app, db } = createRealApiApp();
    const adminCookie = await loginAsAdmin(app);
    const devon = await createHumanFixture(app, adminCookie, { username: "devon-park" });
    const priya = await createHumanFixture(app, adminCookie, { username: "priya-nair" });
    addHumanToGovernanceTeam(db, priya.id);
    const devonRequest = authedRequest(app, devon.cookie);
    const priyaRequest = authedRequest(app, priya.cookie);

    const { body: created } = await submitTicket(devonRequest, {
      title: "Export to CSV button throws 500 error on Safari",
      description: "Clicking Export to CSV in Safari throws a 500.",
    });
    await classifyWithFakeLlm(
      app,
      created,
      makeFakeGenerate("NOT_DEVELOPMENT_WORK", "Classifier missed the technical detail."),
    );
    await devonRequest(`/api/tickets/${created.id}/override`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toResult: "DEVELOPMENT_WORK" }),
    });

    // When Priya Nair reviews the ticket's classification history
    const historyRes = await priyaRequest(`/api/tickets/${created.id}/classification-history`);
    const history = (await historyRes.json()) as any[];

    // Then she can see the original classification, the override, and who made it
    expect(history.map((entry: any) => entry.eventType)).toEqual([
      "INITIAL_CLASSIFICATION",
      "OVERRIDE",
    ]);
    const overrideEntry = history[1];
    expect(overrideEntry.fromResult).toBe("NOT_DEVELOPMENT_WORK");
    expect(overrideEntry.toResult).toBe("DEVELOPMENT_WORK");
    expect(overrideEntry.actorId).toBe(devon.id);
    expect(overrideEntry.createdAt).toBeGreaterThan(0);
  });

  it.skip("[@US-03] A redelivered identical override action is a no-op", async () => {
    const { app } = createRealApiApp();
    const adminCookie = await loginAsAdmin(app);
    const devon = await createHumanFixture(app, adminCookie, { username: "devon-park" });
    const devonRequest = authedRequest(app, devon.cookie);

    const { body: created } = await submitTicket(devonRequest, {
      title: "Export to CSV button throws 500 error on Safari",
      description: "Clicking Export to CSV in Safari throws a 500.",
    });
    await classifyWithFakeLlm(
      app,
      created,
      makeFakeGenerate("NOT_DEVELOPMENT_WORK", "Classifier missed the technical detail."),
    );

    // Given Devon has already overridden the classification once
    await devonRequest(`/api/tickets/${created.id}/override`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toResult: "DEVELOPMENT_WORK" }),
    });
    const beforeHistory = (await (
      await devonRequest(`/api/tickets/${created.id}/classification-history`)
    ).json()) as any[];

    // When the same override action is redelivered (event bus at-least-once guarantee)
    await devonRequest(`/api/tickets/${created.id}/override`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toResult: "DEVELOPMENT_WORK" }),
    });

    // Then no duplicate audit row is written
    const afterHistory = (await (
      await devonRequest(`/api/tickets/${created.id}/classification-history`)
    ).json()) as any[];
    expect(afterHistory).toHaveLength(beforeHistory.length);
  });

  it.skip("[@US-03] A governance override back to NOT DEVELOPMENT WORK is audited without re-triggering implementation", async () => {
    const { app, db } = createRealApiApp();
    const adminCookie = await loginAsAdmin(app);
    const maria = await createHumanFixture(app, adminCookie, { username: "maria-santos" });
    const priya = await createHumanFixture(app, adminCookie, { username: "priya-nair" });
    addHumanToGovernanceTeam(db, priya.id);
    const mariaRequest = authedRequest(app, maria.cookie);
    const priyaRequest = authedRequest(app, priya.cookie);

    // Given a ticket was classified as development work
    const { body: created } = await submitTicket(mariaRequest, {
      title: "Investigate why nightly sync job is 40 min slower this week",
      description: "Turned out to be a false positive — no code change needed after all.",
    });
    await classifyWithFakeLlm(
      app,
      created,
      makeFakeGenerate("DEVELOPMENT_WORK", "Looked like a code-level fix at first glance."),
    );

    // When Priya Nair, on governance review, overrides it back to NOT DEVELOPMENT WORK
    const overrideRes = await priyaRequest(`/api/tickets/${created.id}/override`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toResult: "NOT_DEVELOPMENT_WORK" }),
    });

    // Then the ticket reflects the corrected result and the audit trail records the reversal
    expect(overrideRes.status).toBe(200);
    expect((await readTicket(mariaRequest, created.id)).classificationResult).toBe(
      "NOT_DEVELOPMENT_WORK",
    );
  });

  it.skip("[@infrastructure-failure @in-memory @US-02] HttpTicketRepository surfaces a network failure from the classification-recording call, never silently swallowed", async () => {
    const failingApiFetch = async (): Promise<Response> => {
      throw new Error("fetch failed: connection reset");
    };
    const repository = createHttpTicketRepository({ apiFetch: failingApiFetch });

    await expect(
      repository.recordClassification({
        ticketId: "TICKET-9001",
        result: "DEVELOPMENT_WORK",
        rationale: "n/a",
      }),
    ).rejects.toThrow(/connection reset/);
  });

  it.skip("[@infrastructure-failure @in-memory @US-02] A Classifier generate() timeout is treated as a classification failure, not left pending", async () => {
    const { app } = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    const { body: created } = await submitTicket(request, {
      title: "Something is broken on checkout",
      description: "Not sure what.",
    });

    await classifyWithFakeLlm(app, created, makeRejectingGenerate("ETIMEDOUT"));

    const readBody = await readTicket(request, created.id);
    expect(readBody.classificationStatus).toBe("FAILED");
    expect(readBody.classificationStatus).not.toBe("PENDING");
  });
});

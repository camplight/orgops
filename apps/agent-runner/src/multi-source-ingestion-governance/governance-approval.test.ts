import { describe, expect, it } from "vitest";
import { authedRequest, createRealApiApp, loginAsAdmin } from "./acceptance-test-support";
import { evaluateGuardrailForCompletion } from "./guardrail-evaluator";

// US-12: Ticket Submitter Reviews and Approves or Requests Changes to Completed Implementation.
// Traceability: docs/feature/multi-source-ingestion-governance/discuss/user-stories.md US-12.
//
// Walking-Skeleton Strategy B: real SQLite + real Hono API app for all local I/O. This story
// has no costly external dependency (unlike US-11's Trello CLI), so every HTTP scenario here is
// @real-io through the real driving port (the HTTP route), per Mandate 1 (hexagonal boundary
// enforcement) — internal pure decision functions (decideApprove/decideRequestChanges/
// decideGovernanceSignoff in governance-approval-handler.ts) are exercised indirectly through
// these routes, never called directly from acceptance tests. The Guardrail Evaluator (a
// separate, event-consuming component with no HTTP surface of its own) is exercised directly,
// mirroring intent-watchdog.ts's directly-called pure-function shape.
//
// Every scenario authenticates as the seeded admin human (this codebase's only human fixture
// today) except the one scenario that deliberately omits a session, which now correctly expects
// 401 (no fixture yet distinguishes "authenticated but wrong role" from "not authenticated" —
// that would require a second human + team-membership fixture the ticket-classification track
// does not provide yet).

describe("US-12: submitter approve/request-changes governance gate", () => {
  // DEFERRED: needs a real, queryable `nwave_runs`/`nwave_run_completions` row for `run-1043`
  // (nwave-invocation-engine/progress-trust-ux not yet delivered) — see deliver/deferred-scenarios.md
  it.skip("[@walking_skeleton @real-io @driving_port @US-12] Maria approves a completed implementation and the ticket is marked resolved", async () => {
    const app = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given TICKET-1043's completion summary shows 6/6 scenarios passed
    // When Maria Santos selects "Approve"
    const approveRes = await request("/api/nwave-runs/run-1043/completion-summary/approve", {
      method: "POST",
    });

    // Then TICKET-1043 is marked resolved
    expect(approveRes.status).toBe(200);
    const body = (await approveRes.json()) as { ticketResolutionStatus?: string };
    expect(body.ticketResolutionStatus).toBe("RESOLVED");
  });

  // DEFERRED: needs a real, queryable `nwave_runs`/`nwave_run_completions` row for `run-1042`
  // (nwave-invocation-engine/progress-trust-ux not yet delivered) — see deliver/deferred-scenarios.md
  it.skip("[@US-12] Devon requests changes with specific feedback and the original context is preserved", async () => {
    const app = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given TICKET-1042's completion summary is posted
    // When Devon Park selects "Request changes" and notes "handles Safari but breaks on Firefox now"
    const res = await request("/api/nwave-runs/run-1042/completion-summary/request-changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "handles Safari but breaks on Firefox now" }),
    });

    // Then a new implementation cycle starts scoped to that feedback, and the original
    // context/history is preserved, not discarded
    expect(res.status).toBe(200);
    const body = (await res.json()) as { newRunId?: string; channelId?: string };
    expect(body.newRunId).toBeTruthy();
  });

  // DEFERRED: needs a real, queryable `nwave_runs`/`nwave_run_completions` row for `run-held`
  // (nwave-invocation-engine/progress-trust-ux not yet delivered) — see deliver/deferred-scenarios.md
  it.skip("[@US-12] a run that touched a file outside the guardrail allowlist requires governance sign-off before Maria can approve", async () => {
    const app = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given a completed run touched a file outside the configured guardrail allowlist
    // (governance_hold_reason set by the Guardrail Evaluator)
    // When Maria attempts to approve before Priya reviews the exception
    const prematureApproveRes = await request(
      "/api/nwave-runs/run-held/completion-summary/approve",
      { method: "POST" },
    );

    // Then "Approve" is not available to Maria until Priya provides explicit sign-off — a
    // structural rejection (403), not merely absent from the UI
    expect(prematureApproveRes.status).toBe(403);

    // When Priya Nair reviews the flagged exception and signs off
    const signoffRes = await request(
      "/api/nwave-runs/run-held/completion-summary/governance-signoff",
      { method: "POST" },
    );
    expect(signoffRes.status).toBe(200);

    // Then Approve becomes available
    const approveAfterSignoffRes = await request(
      "/api/nwave-runs/run-held/completion-summary/approve",
      { method: "POST" },
    );
    expect(approveAfterSignoffRes.status).toBe(200);
  });

  // DEFERRED: needs a real, queryable `nwave_runs`/`nwave_run_completions` row for `run-1043`
  // (nwave-invocation-engine/progress-trust-ux not yet delivered) — see deliver/deferred-scenarios.md
  it.skip("[@US-12] anyone with governance access can see who approved TICKET-1043 and when", async () => {
    const app = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given TICKET-1043 was approved by Maria Santos
    await request("/api/nwave-runs/run-1043/completion-summary/approve", { method: "POST" });

    // When anyone with governance access reviews the ticket history
    const historyRes = await request("/api/nwave-runs/run-1043/cycle-history");

    // Then they can see who approved it and when
    expect(historyRes.status).toBe(200);
    const history = (await historyRes.json()) as Array<{
      eventType?: string;
      actorId?: string;
      createdAt?: number;
    }>;
    expect(history.some((entry) => entry.eventType === "APPROVED" && entry.actorId)).toBe(true);
  });

  // DEFERRED: needs a real, queryable `nwave_runs`/`nwave_run_completions` row for
  // `run-no-file-data` (nwave-invocation-engine/progress-trust-ux not yet delivered) — see
  // deliver/deferred-scenarios.md
  it.skip("[@US-12] guardrail evaluation fails closed to governance hold when changed-file data is unavailable", async () => {
    const app = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given a run completes without changedFilePaths data (true for every run today, since the
    // DELIVER-wave output contract gap remains open) — this is the priority-1
    // correctness/auditability quality attribute: never fail open
    // When the submitter attempts to approve immediately after completion
    const approveRes = await request("/api/nwave-runs/run-no-file-data/completion-summary/approve", {
      method: "POST",
    });

    // Then approval is withheld pending governance sign-off (403), never silently allowed (200)
    expect(approveRes.status).toBe(403);
  });

  // DEFERRED: needs a real, queryable `nwave_runs`/`nwave_run_completions` row for
  // `run-held-for-anyone` (nwave-invocation-engine/progress-trust-ux not yet delivered) — see
  // deliver/deferred-scenarios.md
  it.skip("[@property @US-12] Approve is never available while a run is on governance hold, regardless of who requests it", async () => {
    const app = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given any run currently on governance hold
    // When several different actor identities all attempt to approve it directly (the
    // authenticated session is the only real fixture available; the actor-id header stands in
    // for "any requester", since the gate must be structural, not requester-dependent)
    const attempts = await Promise.all(
      ["maria-santos", "priya-nair", "unknown-actor"].map((actor) =>
        request("/api/nwave-runs/run-held-for-anyone/completion-summary/approve", {
          method: "POST",
          headers: { "x-orgops-acting-as": actor },
        }),
      ),
    );

    // Then none of them succeed — every attempt is rejected with the same structural 403, for
    // any requester, not merely "not 200" (which a not-implemented route would also satisfy)
    for (const res of attempts) {
      expect(res.status).toBe(403);
    }
  });

  it("[@US-12] an unauthorized governance sign-off attempt is rejected before any write", async () => {
    const app = createRealApiApp();

    // Given someone with no authenticated session attempts to sign off
    // When they call the governance-signoff action
    const res = await app.request(
      "http://localhost/api/nwave-runs/run-held/completion-summary/governance-signoff",
      { method: "POST" },
    );

    // Then the request is rejected before any write
    expect(res.status).toBe(401);
  });

  // DEFERRED: needs a real, queryable `nwave_runs`/`nwave_run_completions` row for `run-1043`
  // (nwave-invocation-engine/progress-trust-ux not yet delivered) — see deliver/deferred-scenarios.md
  it.skip("[@US-12] a redelivered approval action is a no-op, not a second decision", async () => {
    const app = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given TICKET-1043 was already approved once
    await request("/api/nwave-runs/run-1043/completion-summary/approve", { method: "POST" });

    // When the same approve action is redelivered (e.g. a retried webhook/client call)
    const redeliveredRes = await request("/api/nwave-runs/run-1043/completion-summary/approve", {
      method: "POST",
    });

    // Then it is a no-op — still resolved, no duplicate audit row
    expect(redeliveredRes.status).toBe(200);
    const historyRes = await request("/api/nwave-runs/run-1043/cycle-history");
    const history = (await historyRes.json()) as Array<{ eventType?: string }>;
    expect(history.filter((entry) => entry.eventType === "APPROVED")).toHaveLength(1);
  });

  it("[@driving_adapter @real-io @US-12] a governance-team member manages the guardrail allowlist and sees new patterns reflected in governance decisions", async () => {
    const app = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given a governance-team member wants to allow a new path pattern
    // When they add "src/**" to the allowlist
    const addRes = await request("/api/guardrail-allowlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pathPattern: "src/**" }),
    });
    expect(addRes.status).toBe(201);
    const added = (await addRes.json()) as { id?: string };

    // Then the pattern appears in the listing
    const listRes = await request("/api/guardrail-allowlist");
    expect(listRes.status).toBe(200);
    const entries = (await listRes.json()) as Array<{ pathPattern?: string }>;
    expect(entries.map((entry) => entry.pathPattern)).toContain("src/**");

    // When they remove it
    const deleteRes = await request(`/api/guardrail-allowlist/${added.id}`, { method: "DELETE" });

    // Then it is removed
    expect(deleteRes.status).toBe(204);
  });

  // Note (step 02-02): a scenario asserting 403 for an authenticated-but-non-governance human
  // is intentionally not added here, for the same reason trello-ingestion.test.ts's equivalent
  // note documents: this codebase's only human fixture today is the seeded admin
  // (acceptance-test-support.ts's loginAsAdmin), and admin is now a real governance-team
  // member. Adding a second, logged-in-but-non-governance human would require a further
  // acceptance-test-support.ts extension beyond this step's scope.
  // `canManageTrelloIngestion`'s false-path is still exercised indirectly here: the
  // "unauthorized governance sign-off attempt" scenario above proves this feature's routes are
  // gated at all (global auth gate, no session -> 401 before any handler runs), and
  // trello-ingestion.test.ts already documents the equivalent gap for the same access-control
  // function reused by this route file.

  it("[@US-12] the guardrail evaluator itself holds every completion for governance review while file-change data is unavailable", () => {
    // Given a run completes and its changedFilePaths data is unavailable (true for every run
    // today, per ADR-0010)
    // When the Guardrail Evaluator processes the completion event directly (this component's
    // own driving port, mirroring intent-watchdog.ts's directly-called pure-function shape)
    // Then it holds for governance review with an explicit, honest reason — never silently
    // allowing approval
    const decision = evaluateGuardrailForCompletion({ runId: "run-no-file-data" }, []);
    expect(decision.approvalStatus).toBe("GOVERNANCE_HOLD");
  });

  it("[@US-12] the guardrail evaluator clears every path covered by the allowlist", () => {
    // Given a run's changedFilePaths are all covered by the allowlist
    // When the Guardrail Evaluator processes the completion event directly
    const decision = evaluateGuardrailForCompletion(
      { runId: "run-covered", changedFilePaths: ["src/foo.ts", "src/bar.ts"] },
      [{ id: "allow-1", pathPattern: "src/**" }],
    );

    // Then approval becomes available immediately, with no governance step
    expect(decision.approvalStatus).toBe("PENDING");
  });

  it("[@US-12] the guardrail evaluator holds for governance review and names the uncovered path when only some changed paths are covered", () => {
    // Given a run's changedFilePaths include one path outside every allowlist pattern
    // When the Guardrail Evaluator processes the completion event directly
    const decision = evaluateGuardrailForCompletion(
      { runId: "run-partially-covered", changedFilePaths: ["src/foo.ts", "infra/terraform/main.tf"] },
      [{ id: "allow-1", pathPattern: "src/**" }],
    );

    // Then it holds for governance review, naming the specific uncovered path so a reviewer
    // knows exactly what to check — not merely "some path is uncovered"
    expect(decision.approvalStatus).toBe("GOVERNANCE_HOLD");
    expect(decision.governanceHoldReason).toContain("infra/terraform/main.tf");
  });
});

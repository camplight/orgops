// Domain types owned by the nwave-invocation-engine track (US-04).
// See docs/product/architecture/brief.md "Application Architecture" -> "Data Model" and
// "Component Architecture". Mirrors the naming/shape convention already used by
// apps/agent-runner/src/multi-source-ingestion-governance/types.ts (a sibling track's own
// scaffold types file), not re-derived independently.
//
// WaveName/WAVE_SEQUENCE are the single source of truth for the DISCUSS/DESIGN/DISTILL/DELIVER
// chain order, defined in @orgops/schemas (packages/schemas/src/nwave-lifecycle.ts) since
// apps/api/src/routes/nwave-runs.ts also needs this exact sequence and both containers already
// depend on @orgops/schemas — re-exported here so every file in this module keeps importing
// them from "./types" unchanged.
import type { WaveName } from "@orgops/schemas";

export const __SCAFFOLD__ = true;

export type { WaveName };
export { WAVE_SEQUENCE } from "@orgops/schemas";

export type RunStatus =
  | "PENDING_CONFIRMATION"
  | "STARTING"
  | "RUNNING"
  | "HALTED"
  | "COMPLETED"
  | "FAILED"
  | "START_FAILED";

export type WaveStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "HALTED";

export type NwaveRun = {
  id: string;
  ticketRef: string;
  channelId: string;
  status: RunStatus;
  currentWave: WaveName | null;
  restatementText: string;
  confirmedAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  failureReason: string | null;
};

export type NwaveRunWave = {
  id: string;
  runId: string;
  waveName: WaveName;
  sequence: number;
  processId: string | null;
  status: WaveStatus;
  startedAt: number | null;
  endedAt: number | null;
  exitCode: number | null;
};

/**
 * Observable contract per US-04's Solution section: `nwave-invocation-engine` subscribes to
 * this single event (per brief.md "Observable Contract for nwave-invocation-engine"), never
 * inspecting classification internals itself. No prerequisite scaffold is needed for this
 * event: it is data on the existing channel-scoped event bus, not a route or table owned by
 * ticket-classification.
 */
export type TicketClassificationConfirmedPayload = {
  ticketId: string;
  channelId: string;
  rationale: string;
};

export type ConfirmationOutcome =
  | { kind: "CONFIRMED"; ticketRef: string; confirmedRestatementText: string }
  | { kind: "CORRECTED"; ticketRef: string; correctionNote: string }
  | { kind: "PENDING" };

export const __SCAFFOLD__ = true;

export type TrelloCardSnapshot = {
  id: string;
  name: string;
  description: string;
  listId: string;
  listName: string;
  url: string;
};

export type ApprovalStatus = "PENDING" | "APPROVED" | "CHANGES_REQUESTED" | "GOVERNANCE_HOLD";

export type SuggestedNextStep = "RETRY" | "ESCALATE" | "CLOSE";

export type FollowOnRunCycleReason = "RETRY" | "CHANGES_REQUESTED";

export type IngestedTicket = {
  id: string;
  source: "TRELLO" | "NATIVE_FORM";
  sourceRef: string | null;
  title: string;
  resolutionStatus: "OPEN" | "RESOLVED" | "ESCALATED" | "CLOSED";
};

export type GuardrailAllowlistEntry = {
  id: string;
  pathPattern: string;
};

export type GuardrailEvaluation = {
  approvalStatus: Extract<ApprovalStatus, "PENDING" | "GOVERNANCE_HOLD">;
  governanceHoldReason?: string;
};

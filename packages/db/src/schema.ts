import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";
import { CHANNEL_KINDS } from "./channel-kinds";
import { AGENT_VISIBILITY, CHANNEL_VISIBILITY } from "./visibility";

export const migrations = sqliteTable("migrations", {
  id: text("id").primaryKey(),
  applied_at: integer("applied_at").notNull()
});

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  icon: text("icon"),
  description: text("description"),
  model_id: text("model_id").notNull(),
  system_instructions: text("system_instructions").notNull().default(""),
  soul_path: text("soul_path").notNull(),
  soul_contents: text("soul_contents").notNull().default(""),
  workspace_path: text("workspace_path").notNull(),
  allow_outside_workspace: integer("allow_outside_workspace")
    .notNull()
    .default(0),
  llm_call_timeout_ms: integer("llm_call_timeout_ms"),
  classic_max_model_steps: integer("classic_max_model_steps"),
  context_session_gap_ms: integer("context_session_gap_ms"),
  emit_audit_events: integer("emit_audit_events").notNull().default(1),
  memory_context_mode: text("memory_context_mode")
    .notNull()
    .default("PER_CHANNEL_CROSS_CHANNEL"),
  mode: text("mode").notNull().default("CLASSIC"),
  visibility: text("visibility").notNull().default(AGENT_VISIBILITY.PUBLIC),
  owner_human_id: text("owner_human_id"),
  desired_state: text("desired_state").notNull().default("RUNNING"),
  runtime_state: text("runtime_state").notNull().default("STOPPED"),
  assigned_runner_id: text("assigned_runner_id"),
  last_heartbeat_at: integer("last_heartbeat_at"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
  enabled_skills_json: text("enabled_skills_json").notNull().default("[]"),
  always_preloaded_skills_json: text("always_preloaded_skills_json")
    .notNull()
    .default("[]"),
  wrapped_config_json: text("wrapped_config_json").notNull().default("{}")
});

export const runnerNodes = sqliteTable("runner_nodes", {
  id: text("id").primaryKey(),
  display_name: text("display_name").notNull(),
  hostname: text("hostname"),
  platform: text("platform"),
  arch: text("arch"),
  version: text("version"),
  metadata_json: text("metadata_json").notNull().default("{}"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
  last_seen_at: integer("last_seen_at").notNull()
});

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  created_at: integer("created_at").notNull()
});

export const humans = sqliteTable("humans", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  must_change_password: integer("must_change_password").notNull().default(1),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
  invited_by_human_id: text("invited_by_human_id")
});

export const teamMemberships = sqliteTable(
  "team_memberships",
  {
    team_id: text("team_id").notNull(),
    member_type: text("member_type").notNull(),
    member_id: text("member_id").notNull()
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.team_id, table.member_type, table.member_id]
    })
  })
);

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  metadata_json: text("metadata_json"),
  visibility: text("visibility").notNull().default(CHANNEL_VISIBILITY.PUBLIC),
  owner_human_id: text("owner_human_id"),
  kind: text("kind").notNull().default(CHANNEL_KINDS.GROUP),
  direct_participant_key: text("direct_participant_key"),
  created_at: integer("created_at").notNull()
}, (table) => ({
  uidxChannelsDirectKey: uniqueIndex("uidx_channels_direct_participant_key")
    .on(table.direct_participant_key)
    .where(sql`${table.direct_participant_key} IS NOT NULL`)
}));

export const channelSubscriptions = sqliteTable(
  "channel_subscriptions",
  {
    channel_id: text("channel_id").notNull(),
    subscriber_type: text("subscriber_type").notNull(),
    subscriber_id: text("subscriber_id").notNull()
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.channel_id, table.subscriber_type, table.subscriber_id]
    })
  })
);

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  human_id: text("human_id").notNull(),
  agent_name: text("agent_name"),
  channel_id: text("channel_id"),
  title: text("title"),
  created_at: integer("created_at").notNull()
});

export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  conversation_id: text("conversation_id").notNull(),
  title: text("title"),
  created_at: integer("created_at").notNull()
});

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payload_json: text("payload_json").notNull(),
    source: text("source").notNull(),
    channel_id: text("channel_id"),
    parent_event_id: text("parent_event_id"),
    deliver_at: integer("deliver_at"),
    status: text("status").notNull().default("PENDING"),
    idempotency_key: text("idempotency_key"),
    created_at: integer("created_at").notNull(),
    fail_count: integer("fail_count").notNull().default(0),
    last_error: text("last_error")
  },
  (table) => ({
    idxEventsDeliverAt: index("idx_events_deliver_at").on(table.status, table.deliver_at),
    idxEventsChannel: index("idx_events_channel").on(table.channel_id, table.created_at),
    uidxEventsIdempotency: uniqueIndex("uidx_events_idempotency")
      .on(table.idempotency_key)
      .where(sql`${table.idempotency_key} IS NOT NULL`)
  })
);

export const eventReceipts = sqliteTable(
  "event_receipts",
  {
    event_id: text("event_id").notNull(),
    agent_name: text("agent_name").notNull(),
    status: text("status").notNull().default("PENDING"),
    delivered_at: integer("delivered_at")
  },
  (table) => ({
    pk: primaryKey({ columns: [table.event_id, table.agent_name] }),
    idxEventReceiptsAgentStatus: index("idx_event_receipts_agent_status").on(
      table.agent_name,
      table.status,
      table.delivered_at
    ),
    idxEventReceiptsEventStatus: index("idx_event_receipts_event_status").on(
      table.event_id,
      table.status
    )
  })
);

export const processes = sqliteTable("processes", {
  id: text("id").primaryKey(),
  agent_name: text("agent_name").notNull(),
  channel_id: text("channel_id"),
  cmd: text("cmd").notNull(),
  cwd: text("cwd").notNull(),
  pid: integer("pid"),
  execution_mode: text("execution_mode").notNull().default("ASYNC"),
  state: text("state").notNull(),
  exit_code: integer("exit_code"),
  started_at: integer("started_at").notNull(),
  ended_at: integer("ended_at")
});

export const processOutput = sqliteTable(
  "process_output",
  {
    id: text("id").primaryKey(),
    process_id: text("process_id").notNull(),
    seq: integer("seq").notNull(),
    stream: text("stream").notNull(),
    text: text("text").notNull(),
    ts: integer("ts").notNull()
  },
  (table) => ({
    uidxProcessOutput: uniqueIndex("uidx_process_output").on(table.process_id, table.seq)
  })
);

export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  storage_path: text("storage_path").notNull(),
  original_name: text("original_name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  created_by_human_id: text("created_by_human_id"),
  created_by_agent_name: text("created_by_agent_name"),
  created_at: integer("created_at").notNull()
});

export const secrets = sqliteTable(
  "secrets",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    scope_type: text("scope_type").notNull(),
    scope_id: text("scope_id"),
    ciphertext_b64: text("ciphertext_b64").notNull(),
    created_at: integer("created_at").notNull()
  },
  (table) => ({
    uniqueScopeName: uniqueIndex("secrets_name_scope_type_scope_id_unique").on(
      table.name,
      table.scope_type,
      table.scope_id
    )
  })
);

export const models = sqliteTable("models", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  model_name: text("model_name").notNull(),
  enabled: integer("enabled").notNull(),
  defaults_json: text("defaults_json").notNull(),
  created_at: integer("created_at").notNull()
});

export const channelMemoryRecent = sqliteTable(
  "channel_memory_recent",
  {
    agent_name: text("agent_name").notNull(),
    channel_id: text("channel_id").notNull(),
    summary_text: text("summary_text").notNull().default(""),
    window_start_at: integer("window_start_at").notNull().default(0),
    last_processed_at: integer("last_processed_at").notNull().default(0),
    last_processed_event_id: text("last_processed_event_id"),
    version: integer("version").notNull().default(0),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.agent_name, table.channel_id] }),
    idxChannelMemoryRecentAgentUpdated: index("idx_channel_memory_recent_agent_updated").on(
      table.agent_name,
      table.updated_at
    )
  })
);

export const channelMemoryFull = sqliteTable(
  "channel_memory_full",
  {
    agent_name: text("agent_name").notNull(),
    channel_id: text("channel_id").notNull(),
    summary_text: text("summary_text").notNull().default(""),
    last_processed_at: integer("last_processed_at").notNull().default(0),
    last_processed_event_id: text("last_processed_event_id"),
    version: integer("version").notNull().default(0),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.agent_name, table.channel_id] }),
    idxChannelMemoryFullAgentUpdated: index("idx_channel_memory_full_agent_updated").on(
      table.agent_name,
      table.updated_at
    )
  })
);

export const crossChannelMemoryRecent = sqliteTable(
  "cross_channel_memory_recent",
  {
    agent_name: text("agent_name").primaryKey(),
    summary_text: text("summary_text").notNull().default(""),
    window_start_at: integer("window_start_at").notNull().default(0),
    last_processed_at: integer("last_processed_at").notNull().default(0),
    last_processed_event_id: text("last_processed_event_id"),
    version: integer("version").notNull().default(0),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull()
  },
  (table) => ({
    idxCrossChannelMemoryRecentUpdated: index("idx_cross_channel_memory_recent_updated").on(
      table.updated_at
    )
  })
);

export const crossChannelMemoryFull = sqliteTable(
  "cross_channel_memory_full",
  {
    agent_name: text("agent_name").primaryKey(),
    summary_text: text("summary_text").notNull().default(""),
    last_processed_at: integer("last_processed_at").notNull().default(0),
    last_processed_event_id: text("last_processed_event_id"),
    version: integer("version").notNull().default(0),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull()
  },
  (table) => ({
    idxCrossChannelMemoryFullUpdated: index("idx_cross_channel_memory_full_updated").on(
      table.updated_at
    )
  })
);

// --- multi-source-ingestion-governance (owned by this track; see
// docs/product/architecture/brief.md "Multi-Source Ingestion & Governance" -> "Data Model") ---

export const trelloIngestionBoards = sqliteTable("trello_ingestion_boards", {
  board_id: text("board_id").primaryKey(),
  trigger_list_ids: text("trigger_list_ids"),
  default_submitter_human_id: text("default_submitter_human_id").notNull(),
  enabled: integer("enabled").notNull().default(1),
  activated_at: integer("activated_at").notNull(),
  last_polled_at: integer("last_polled_at"),
  last_poll_status: text("last_poll_status"),
  last_poll_error: text("last_poll_error")
});

export const trelloIngestionSeenCards = sqliteTable(
  "trello_ingestion_seen_cards",
  {
    id: text("id").primaryKey(),
    board_id: text("board_id").notNull(),
    card_id: text("card_id").notNull(),
    first_observed_at: integer("first_observed_at").notNull()
  },
  (table) => ({
    uidxSeenCardsBoardCard: uniqueIndex("uidx_trello_ingestion_seen_cards_board_card").on(
      table.board_id,
      table.card_id
    )
  })
);

export const guardrailAllowlistEntries = sqliteTable("guardrail_allowlist_entries", {
  id: text("id").primaryKey(),
  path_pattern: text("path_pattern").notNull(),
  created_by: text("created_by").notNull(),
  created_at: integer("created_at").notNull()
});

export const guardrailDecisionAudit = sqliteTable("guardrail_decision_audit", {
  id: text("id").primaryKey(),
  run_id: text("run_id").notNull(),
  event_type: text("event_type").notNull(),
  actor_type: text("actor_type").notNull(),
  actor_id: text("actor_id"),
  note: text("note"),
  created_at: integer("created_at").notNull()
});

export const nwaveRunStuckFlags = sqliteTable("nwave_run_stuck_flags", {
  id: text("id").primaryKey(),
  run_id: text("run_id").notNull(),
  wave_sequence: integer("wave_sequence").notNull(),
  flagged_at: integer("flagged_at").notNull(),
  cleared_at: integer("cleared_at")
});

// --- nwave-invocation-engine (owned by this track; see
// docs/product/architecture/brief.md "Application Architecture" -> "Data Model") ---

export const nwaveRuns = sqliteTable("nwave_runs", {
  id: text("id").primaryKey(),
  ticket_ref: text("ticket_ref").notNull(),
  channel_id: text("channel_id").notNull(),
  status: text("status").notNull(),
  current_wave: text("current_wave"),
  restatement_text: text("restatement_text").notNull(),
  confirmed_at: integer("confirmed_at"),
  started_at: integer("started_at"),
  ended_at: integer("ended_at"),
  failure_reason: text("failure_reason")
});

export const nwaveRunWaves = sqliteTable(
  "nwave_run_waves",
  {
    id: text("id").primaryKey(),
    run_id: text("run_id").notNull(),
    wave_name: text("wave_name").notNull(),
    sequence: integer("sequence").notNull(),
    process_id: text("process_id"),
    status: text("status").notNull(),
    started_at: integer("started_at"),
    ended_at: integer("ended_at"),
    exit_code: integer("exit_code")
  },
  (table) => ({
    idxNwaveRunWavesRunId: index("idx_nwave_run_waves_run_id").on(table.run_id)
  })
);

// --- ticket-classification (owned by this track; see
// docs/product/architecture/brief.md "Ticket Classification" -> "Data Model", ADR-0003
// (current-state-plus-append-only-audit-log rationale) and ADR-0009 (the (source, source_ref)
// uniqueness guarantee required for Trello-sourced tickets reusing this same table)) ---

export const tickets = sqliteTable(
  "tickets",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    source: text("source").notNull().default("NATIVE_FORM"),
    source_ref: text("source_ref"),
    channel_id: text("channel_id").notNull(),
    submitter_human_id: text("submitter_human_id").notNull(),
    is_low_detail: integer("is_low_detail").notNull().default(0),
    idempotency_key: text("idempotency_key"),
    classification_status: text("classification_status").notNull().default("PENDING"),
    classification_result: text("classification_result"),
    classification_rationale: text("classification_rationale"),
    classification_failure_reason: text("classification_failure_reason"),
    classified_at: integer("classified_at"),
    created_at: integer("created_at").notNull()
  },
  (table) => ({
    uidxTicketsIdempotency: uniqueIndex("uidx_tickets_idempotency")
      .on(table.idempotency_key)
      .where(sql`${table.idempotency_key} IS NOT NULL`),
    // ADR-0009 Consequences: required so a Trello-sourced ticket (source=TRELLO, source_ref=
    // <Trello card id>) can never be double-inserted by a redelivered/retried ingestion poll,
    // mirroring the idempotency_key guard native-form submissions already get.
    uidxTicketsSourceRef: uniqueIndex("uidx_tickets_source_source_ref")
      .on(table.source, table.source_ref)
      .where(sql`${table.source_ref} IS NOT NULL`)
  })
);

export const ticketClassificationAudit = sqliteTable(
  "ticket_classification_audit",
  {
    id: text("id").primaryKey(),
    ticket_id: text("ticket_id").notNull(),
    event_type: text("event_type").notNull(),
    from_result: text("from_result"),
    to_result: text("to_result"),
    rationale: text("rationale"),
    actor_type: text("actor_type").notNull(),
    actor_id: text("actor_id"),
    created_at: integer("created_at").notNull()
  },
  (table) => ({
    idxTicketClassificationAuditTicketId: index("idx_ticket_classification_audit_ticket_id").on(
      table.ticket_id
    )
  })
);

export const schema = {
  migrations,
  agents,
  runnerNodes,
  teams,
  humans,
  teamMemberships,
  channels,
  channelSubscriptions,
  conversations,
  threads,
  events,
  eventReceipts,
  processes,
  processOutput,
  files,
  secrets,
  models,
  channelMemoryRecent,
  channelMemoryFull,
  crossChannelMemoryRecent,
  crossChannelMemoryFull,
  trelloIngestionBoards,
  trelloIngestionSeenCards,
  guardrailAllowlistEntries,
  guardrailDecisionAudit,
  nwaveRunStuckFlags,
  nwaveRuns,
  nwaveRunWaves,
  tickets,
  ticketClassificationAudit
};

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
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
  wrapped_config_json: text("wrapped_config_json").notNull().default("{}"),
  revision: integer("revision").notNull().default(1)
}, (table) => ({
  revisionCheck: check("agents_revision_check", sql`${table.revision} BETWEEN 1 AND 2147483647`),
}));

export const agentProvisionOperations = sqliteTable("agent_provision_operations", {
  operation_id: text("operation_id").notNull(),
  actor_human_id: text("actor_human_id").notNull().references(() => humans.id),
  request_digest: text("request_digest").notNull(),
  state: text("state").notNull().default("COMPLETED"),
  agent_id: text("agent_id").notNull().references(() => agents.id),
  receipt_json: text("receipt_json").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
}, (table) => ({
  actorOperation: primaryKey({ columns: [table.actor_human_id, table.operation_id], name: "agent_provision_operations_pk" }),
  digestIndex: index("agent_provision_operations_digest").on(table.request_digest),
  operationIdCheck: check("agent_provision_operations_operation_id_check", sql`length(${table.operation_id}) = 36`),
  requestDigestCheck: check("agent_provision_operations_request_digest_check", sql`length(${table.request_digest}) = 64`),
  stateCheck: check("agent_provision_operations_state_check", sql`${table.state} = 'COMPLETED'`),
  receiptCheck: check("agent_provision_operations_receipt_check", sql`length(${table.receipt_json}) BETWEEN 2 AND 65536`),
}));

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

export const integrationKeys = sqliteTable(
  "integration_keys",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    agent_name: text("agent_name").notNull(),
    token_hash: text("token_hash").notNull().unique(),
    token_prefix: text("token_prefix").notNull(),
    created_by_human_id: text("created_by_human_id"),
    created_at: integer("created_at").notNull(),
    last_used_at: integer("last_used_at"),
    revoked_at: integer("revoked_at")
  },
  (table) => ({
    idxIntegrationKeysAgentName: index("idx_integration_keys_agent_name").on(
      table.agent_name
    )
  })
);

export const agentInvites = sqliteTable(
  "agent_invites",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    agent_name: text("agent_name").notNull(),
    agent_visibility: text("agent_visibility")
      .notNull()
      .default(AGENT_VISIBILITY.PUBLIC),
    token_hash: text("token_hash").notNull().unique(),
    token_prefix: text("token_prefix").notNull(),
    channel_ids_json: text("channel_ids_json").notNull().default("[]"),
    allow_channel_expansion: integer("allow_channel_expansion")
      .notNull()
      .default(0),
    runner_scope_mode: text("runner_scope_mode").notNull().default("SCOPED"),
    wrapped_config_json: text("wrapped_config_json").notNull().default("{}"),
    max_uses: integer("max_uses").notNull().default(1),
    use_count: integer("use_count").notNull().default(0),
    created_by_type: text("created_by_type").notNull().default("HUMAN"),
    created_by_id: text("created_by_id"),
    created_by_human_id: text("created_by_human_id"),
    created_at: integer("created_at").notNull(),
    expires_at: integer("expires_at"),
    revoked_at: integer("revoked_at"),
    last_redeemed_at: integer("last_redeemed_at"),
  },
  (table) => ({
    idxAgentInvitesAgentName: index("idx_agent_invites_agent_name").on(
      table.agent_name,
    ),
    idxAgentInvitesCreatedAt: index("idx_agent_invites_created_at").on(
      table.created_at,
    ),
  }),
);

export const runnerTokens = sqliteTable(
  "runner_tokens",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    token_hash: text("token_hash").notNull().unique(),
    token_prefix: text("token_prefix").notNull(),
    allowed_agent_name: text("allowed_agent_name"),
    allowed_runner_id: text("allowed_runner_id"),
    allowed_channel_ids_json: text("allowed_channel_ids_json")
      .notNull()
      .default("[]"),
    allow_channel_expansion: integer("allow_channel_expansion")
      .notNull()
      .default(0),
    runner_scope_mode: text("runner_scope_mode").notNull().default("SCOPED"),
    invite_id: text("invite_id"),
    created_by_human_id: text("created_by_human_id"),
    created_at: integer("created_at").notNull(),
    expires_at: integer("expires_at"),
    last_used_at: integer("last_used_at"),
    revoked_at: integer("revoked_at"),
  },
  (table) => ({
    idxRunnerTokensAllowedAgent: index("idx_runner_tokens_allowed_agent").on(
      table.allowed_agent_name,
    ),
    idxRunnerTokensAllowedRunner: index("idx_runner_tokens_allowed_runner").on(
      table.allowed_runner_id,
    ),
  }),
);

export const humans = sqliteTable("humans", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  must_change_password: integer("must_change_password").notNull().default(1),
  is_admin: integer("is_admin").notNull().default(0),
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
  created_at: integer("created_at").notNull(),
  archived_at: integer("archived_at")
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

export const channelViewers = sqliteTable(
  "channel_viewers",
  {
    channel_id: text("channel_id").notNull(),
    viewer_type: text("viewer_type").notNull(),
    viewer_id: text("viewer_id").notNull(),
    created_at: integer("created_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.channel_id, table.viewer_type, table.viewer_id],
    }),
    idxChannelViewersChannel: index("idx_channel_viewers_channel").on(
      table.channel_id,
      table.viewer_type,
    ),
    idxChannelViewersViewer: index("idx_channel_viewers_viewer").on(
      table.viewer_type,
      table.viewer_id,
    ),
  }),
);

export const channelShareLinks = sqliteTable(
  "channel_share_links",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    channel_id: text("channel_id").notNull(),
    created_by_human_id: text("created_by_human_id"),
    created_at: integer("created_at").notNull(),
    expires_at: integer("expires_at"),
    revoked_at: integer("revoked_at"),
  },
  (table) => ({
    idxChannelShareLinksChannel: index("idx_channel_share_links_channel").on(
      table.channel_id,
      table.created_at,
    ),
  }),
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

export const embedConversations = sqliteTable(
  "embed_conversations",
  {
    id: text("id").primaryKey(),
    channel_id: text("channel_id").notNull().unique(),
    agent_name: text("agent_name").notNull(),
    integration_key_id: text("integration_key_id").notNull(),
    idempotency_key: text("idempotency_key"),
    metadata_json: text("metadata_json"),
    created_at: integer("created_at").notNull(),
    archived_at: integer("archived_at")
  },
  (table) => ({
    uidxEmbedConversationsKeyIdempotency: uniqueIndex(
      "uidx_embed_conversations_key_idempotency"
    )
      .on(table.integration_key_id, table.idempotency_key)
      .where(sql`${table.idempotency_key} IS NOT NULL`)
  })
);

export const catalogSources = sqliteTable("catalog_sources", {
  source_id: text("source_id").primaryKey().notNull(),
  display_name: text("display_name").notNull(),
  canonical_url: text("canonical_url").notNull(),
  ssh_user: text("ssh_user"),
  repository_identity: text("repository_identity").notNull(),
  ref: text("ref").notNull(),
  enabled: integer("enabled").notNull(),
  allow_packages: integer("allow_packages").notNull(),
  revision: integer("revision").notNull(),
  removed_at: integer("removed_at"),
  current_snapshot_id: text("current_snapshot_id").references((): AnySQLiteColumn => catalogSnapshots.snapshot_id),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
}, (table) => ({
  repositoryRefUnique: uniqueIndex("uidx_catalog_sources_repository_ref").on(table.repository_identity, table.ref),
  currentSnapshotIndex: index("idx_catalog_sources_current_snapshot").on(table.current_snapshot_id),
  displayNameCheck: check("catalog_sources_display_name_check", sql`length(${table.display_name}) BETWEEN 1 AND 200`),
  refCheck: check("catalog_sources_ref_check", sql`length(${table.ref}) BETWEEN 1 AND 1024`),
  enabledCheck: check("catalog_sources_enabled_check", sql`${table.enabled} IN (0,1)`),
  allowPackagesCheck: check("catalog_sources_allow_packages_check", sql`${table.allow_packages} IN (0,1)`),
  revisionCheck: check("catalog_sources_revision_check", sql`${table.revision} BETWEEN 1 AND 2147483647`),
  removedCheck: check("catalog_sources_removed_check", sql`${table.removed_at} IS NULL OR (${table.enabled}=0 AND ${table.allow_packages}=0)`),
}));

export const catalogSourceReadCredentials = sqliteTable("catalog_source_read_credentials", {
  source_id: text("source_id").primaryKey().notNull().references(() => catalogSources.source_id),
  credential_ref: text("credential_ref").notNull().unique(),
  kind: text("kind").notNull(),
  ciphertext_b64: text("ciphertext_b64").notNull(),
  legacy_binding_source_id: text("legacy_binding_source_id"),
  legacy_credential_ref: text("legacy_credential_ref"),
  revision: integer("revision").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
}, (table) => ({
  kindCheck: check("catalog_source_read_credentials_kind_check", sql`${table.kind}='https-basic'`),
  revisionCheck: check("catalog_source_read_credentials_revision_check", sql`${table.revision} BETWEEN 1 AND 2147483647`),
  legacyBindingCheck: check("catalog_source_read_credentials_legacy_binding_check", sql`(${table.legacy_binding_source_id} IS NULL)=(${table.legacy_credential_ref} IS NULL)`),
}));

export const catalogSyncAttempts = sqliteTable("catalog_sync_attempts", {
  attempt_id: text("attempt_id").primaryKey().notNull(),
  source_id: text("source_id").notNull().references(() => catalogSources.source_id),
  source_revision: integer("source_revision").notNull(),
  state: text("state").notNull(),
  resolved_commit: text("resolved_commit"),
  snapshot_id: text("snapshot_id").references((): AnySQLiteColumn => catalogSnapshots.snapshot_id),
  failure_code: text("failure_code"),
  actor_human_id: text("actor_human_id").notNull().references(() => humans.id),
  revision: integer("revision").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
  completed_at: integer("completed_at"),
}, (table) => ({
  runningUnique: uniqueIndex("uidx_catalog_sync_attempts_running").on(table.source_id).where(sql`${table.state}='RUNNING'`),
  sourceCreatedIndex: index("idx_catalog_sync_attempts_source_created").on(table.source_id, table.created_at),
  sourceRevisionCheck: check("catalog_sync_attempts_source_revision_check", sql`${table.source_revision} BETWEEN 1 AND 2147483647`),
  stateCheck: check("catalog_sync_attempts_state_check", sql`${table.state} IN ('RUNNING','SUCCEEDED','FAILED','ABANDONED')`),
  failureCodeCheck: check("catalog_sync_attempts_failure_code_check", sql`${table.failure_code} IS NULL OR ${table.failure_code} IN ('SOURCE_UNAVAILABLE','SOURCE_NOT_ALLOWED','IDENTITY_CONFLICT','INSPECTION_FAILED','STORAGE_FAILURE','SYNC_FAILED')`),
  revisionCheck: check("catalog_sync_attempts_revision_check", sql`${table.revision} BETWEEN 1 AND 2147483647`),
  completionCheck: check("catalog_sync_attempts_completion_check", sql`(${table.state}='RUNNING' AND ${table.completed_at} IS NULL) OR (${table.state}<>'RUNNING' AND ${table.completed_at} IS NOT NULL)`),
  failedCodeCheck: check("catalog_sync_attempts_failed_code_check", sql`(${table.state}='FAILED' AND ${table.failure_code} IS NOT NULL) OR ${table.state}<>'FAILED'`),
}));

export const catalogSnapshots = sqliteTable("catalog_snapshots", {
  snapshot_id: text("snapshot_id").primaryKey().notNull(),
  source_id: text("source_id").notNull().references(() => catalogSources.source_id),
  source_commit: text("source_commit").notNull(),
  index_digest: text("index_digest").notNull(),
  index_json: text("index_json").notNull(),
  observed_ref: text("observed_ref").notNull(),
  attempt_id: text("attempt_id").notNull().unique().references(() => catalogSyncAttempts.attempt_id),
  created_at: integer("created_at").notNull(),
}, (table) => ({
  sourceCreatedIndex: index("idx_catalog_snapshots_source_created").on(table.source_id, table.created_at),
  sourceCommitUnique: uniqueIndex("uidx_catalog_snapshots_source_commit").on(table.source_id, table.source_commit),
  observationUnique: uniqueIndex("uidx_catalog_snapshots_observation").on(table.source_id, table.source_commit, table.index_digest, table.index_json),
  indexJsonCheck: check("catalog_snapshots_index_json_check", sql`json_valid(${table.index_json}) AND length(CAST(${table.index_json} AS BLOB))<=2097152`),
}));

export const catalogPackageReleases = sqliteTable("catalog_package_releases", {
  package_release_id: text("package_release_id").primaryKey().notNull(),
  authority_source_id: text("authority_source_id").notNull().references(() => catalogSources.source_id),
  content_source_id: text("content_source_id").notNull().references(() => catalogSources.source_id),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  version: text("version").notNull(),
  digest: text("digest").notNull(),
  catalog_commit: text("catalog_commit").notNull(),
  package_commit: text("package_commit").notNull(),
  package_path: text("package_path").notNull(),
  manifest_json: text("manifest_json").notNull(),
  execution_preview_json: text("execution_preview_json").notNull(),
  warnings_json: text("warnings_json").notNull(),
  created_at: integer("created_at").notNull(),
}, (table) => ({
  identityUnique: uniqueIndex("uidx_catalog_package_releases_identity").on(table.authority_source_id, table.name, table.version),
  contentSourceIndex: index("idx_catalog_package_releases_content_source").on(table.content_source_id),
  kindNameIndex: index("idx_catalog_package_releases_kind_name").on(table.kind, table.name, table.version),
  kindCheck: check("catalog_package_releases_kind_check", sql`${table.kind} IN ('skill','native-agent','wrapped-agent')`),
  manifestJsonCheck: check("catalog_package_releases_manifest_json_check", sql`json_valid(${table.manifest_json}) AND length(CAST(${table.manifest_json} AS BLOB))<=262144`),
  previewJsonCheck: check("catalog_package_releases_preview_json_check", sql`json_valid(${table.execution_preview_json}) AND length(CAST(${table.execution_preview_json} AS BLOB))<=262144`),
  warningsJsonCheck: check("catalog_package_releases_warnings_json_check", sql`json_valid(${table.warnings_json}) AND length(CAST(${table.warnings_json} AS BLOB))<=262144`),
}));

export const catalogSnapshotEntries = sqliteTable("catalog_snapshot_entries", {
  snapshot_id: text("snapshot_id").notNull().references(() => catalogSnapshots.snapshot_id),
  package_release_id: text("package_release_id").notNull().references(() => catalogPackageReleases.package_release_id),
  ordinal: integer("ordinal").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.snapshot_id, table.package_release_id] }),
  ordinalUnique: uniqueIndex("uidx_catalog_snapshot_entries_ordinal").on(table.snapshot_id, table.ordinal),
  releaseIndex: index("idx_catalog_snapshot_entries_release").on(table.package_release_id),
  ordinalCheck: check("catalog_snapshot_entries_ordinal_check", sql`${table.ordinal}>=0`),
}));

export const catalogReleaseControls = sqliteTable("catalog_release_controls", {
  package_release_id: text("package_release_id").primaryKey().notNull().references(() => catalogPackageReleases.package_release_id),
  review_state: text("review_state").notNull(),
  review_digest: text("review_digest"),
  reviewed_by_human_id: text("reviewed_by_human_id").references(() => humans.id),
  reviewed_at: integer("reviewed_at"),
  revision: integer("revision").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
}, (table) => ({
  stateIndex: index("idx_catalog_release_controls_state").on(table.review_state, table.updated_at),
  stateCheck: check("catalog_release_controls_state_check", sql`${table.review_state} IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')`),
  revisionCheck: check("catalog_release_controls_revision_check", sql`${table.revision} BETWEEN 1 AND 2147483647`),
  digestCheck: check("catalog_release_controls_digest_check", sql`(${table.review_state}='PENDING' AND ${table.review_digest} IS NULL) OR (${table.review_state}<>'PENDING' AND ${table.review_digest} IS NOT NULL)`),
}));

export const catalogGrants = sqliteTable("catalog_grants", {
  grant_id: text("grant_id").primaryKey().notNull(),
  release_id: text("release_id").notNull().references(() => catalogPackageReleases.package_release_id),
  subject_type: text("subject_type").notNull(),
  human_id: text("human_id").references(() => humans.id),
  revision: integer("revision").notNull(),
  revoked_at: integer("revoked_at"),
  created_by_human_id: text("created_by_human_id").notNull().references(() => humans.id),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
}, (table) => ({
  liveSubjectUnique: uniqueIndex("uidx_catalog_grants_live_subject").on(table.release_id, table.subject_type, sql`COALESCE(${table.human_id},'')`).where(sql`${table.revoked_at} IS NULL`),
  humanIndex: index("idx_catalog_grants_human").on(table.human_id, table.release_id).where(sql`${table.revoked_at} IS NULL`),
  subjectTypeCheck: check("catalog_grants_subject_type_check", sql`${table.subject_type} IN ('ORGANIZATION','HUMAN')`),
  revisionCheck: check("catalog_grants_revision_check", sql`${table.revision} BETWEEN 1 AND 2147483647`),
  subjectCheck: check("catalog_grants_subject_check", sql`(${table.subject_type}='ORGANIZATION' AND ${table.human_id} IS NULL) OR (${table.subject_type}='HUMAN' AND ${table.human_id} IS NOT NULL)`),
}));

export const catalogInstallOperations = sqliteTable("catalog_install_operations", {
  operation_id: text("operation_id").primaryKey().notNull(),
  root_release_id: text("root_release_id").notNull().references(() => catalogPackageReleases.package_release_id),
  closure_digest: text("closure_digest").notNull(),
  state: text("state").notNull(),
  actor_human_id: text("actor_human_id").notNull().references(() => humans.id),
  failure_code: text("failure_code"),
  revision: integer("revision").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
  completed_at: integer("completed_at"),
}, (table) => ({
  releaseIndex: index("idx_catalog_install_operations_release").on(table.root_release_id, table.created_at),
  stateCheck: check("catalog_install_operations_state_check", sql`${table.state} IN ('PENDING','INSTALLING','INSTALLED','FAILED')`),
  failureCodeCheck: check("catalog_install_operations_failure_code_check", sql`${table.failure_code} IS NULL OR ${table.failure_code} IN ('RELEASE_NOT_APPROVED','SOURCE_NOT_ALLOWED','SOURCE_UNAVAILABLE','IDENTITY_CONFLICT','INSPECTION_FAILED','STORAGE_FAILURE')`),
  revisionCheck: check("catalog_install_operations_revision_check", sql`${table.revision} BETWEEN 1 AND 2147483647`),
  failedCodeCheck: check("catalog_install_operations_failed_code_check", sql`(${table.state}='FAILED' AND ${table.failure_code} IS NOT NULL) OR ${table.state}<>'FAILED'`),
}));

export const catalogInstallations = sqliteTable("catalog_installations", {
  release_id: text("release_id").primaryKey().notNull().references(() => catalogPackageReleases.package_release_id),
  artifact_digest: text("artifact_digest").notNull(),
  artifact_path: text("artifact_path").notNull().unique(),
  state: text("state").notNull(),
  installed_by_human_id: text("installed_by_human_id").notNull().references(() => humans.id),
  installed_at: integer("installed_at").notNull(),
  last_verified_at: integer("last_verified_at").notNull(),
  revision: integer("revision").notNull(),
}, (table) => ({
  stateIndex: index("idx_catalog_installations_state").on(table.state, table.last_verified_at),
  stateCheck: check("catalog_installations_state_check", sql`${table.state} IN ('INSTALLED','QUARANTINED')`),
  revisionCheck: check("catalog_installations_revision_check", sql`${table.revision} BETWEEN 1 AND 2147483647`),
}));

export const catalogApiActivations = sqliteTable("catalog_api_activations", {
  release_id: text("release_id").primaryKey().notNull().references(() => catalogPackageReleases.package_release_id),
  approval_state: text("approval_state").notNull(),
  runtime_state: text("runtime_state").notNull(),
  failure_code: text("failure_code"),
  approved_digest: text("approved_digest"),
  approved_by_human_id: text("approved_by_human_id").references(() => humans.id),
  approved_at: integer("approved_at"),
  revision: integer("revision").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
}, (table) => ({
  runtimeIndex: index("idx_catalog_api_activations_runtime").on(table.runtime_state, table.approval_state),
  approvalCheck: check("catalog_api_activations_approval_check", sql`${table.approval_state} IN ('NOT_REQUIRED','AWAITING_APPROVAL','APPROVED','REVOKED')`),
  runtimeCheck: check("catalog_api_activations_runtime_check", sql`${table.runtime_state} IN ('INACTIVE','ACTIVATING','ACTIVE','DEACTIVATING','FAILED')`),
  failureCodeCheck: check("catalog_api_activations_failure_code_check", sql`${table.failure_code} IS NULL OR ${table.failure_code} IN ('INSTALLATION_REQUIRED','API_ACTIVATION_REQUIRED','INSPECTION_FAILED','STORAGE_FAILURE')`),
  approvalBindingCheck: check("catalog_api_activations_approval_binding_check", sql`((${table.approval_state}='APPROVED' AND ${table.approved_digest} IS NOT NULL AND typeof(${table.approved_by_human_id})='text' AND length(${table.approved_by_human_id}) BETWEEN 1 AND 200 AND typeof(${table.approved_at})='integer' AND ${table.approved_at} BETWEEN 0 AND 9007199254740991) OR (${table.approval_state}<>'APPROVED' AND ${table.approved_digest} IS NULL AND ${table.approved_by_human_id} IS NULL AND ${table.approved_at} IS NULL))`),
  activeApprovalCheck: check("catalog_api_activations_active_approval_check", sql`((${table.runtime_state} IN ('ACTIVE','ACTIVATING','DEACTIVATING') AND ${table.approval_state}='APPROVED') OR ${table.runtime_state} NOT IN ('ACTIVE','ACTIVATING','DEACTIVATING'))`),
  failureStateCheck: check("catalog_api_activations_failure_state_check", sql`((${table.runtime_state}='FAILED' AND ${table.failure_code} IS NOT NULL) OR (${table.runtime_state}<>'FAILED' AND ${table.failure_code} IS NULL))`),
  revisionCheck: check("catalog_api_activations_revision_check", sql`${table.revision} BETWEEN 1 AND 2147483647`),
  failedCodeCheck: check("catalog_api_activations_failed_code_check", sql`(${table.runtime_state}='FAILED' AND ${table.failure_code} IS NOT NULL) OR ${table.runtime_state}<>'FAILED'`),
}));

export const agentTemplateOrigins = sqliteTable("agent_template_origins", {
  agent_id: text("agent_id").primaryKey().notNull().references(() => agents.id),
  release_id: text("release_id").notNull().references(() => catalogPackageReleases.package_release_id),
  mode: text("mode").notNull(),
  consumed_by_kind: text("consumed_by_kind").notNull(),
  consumed_by_human_id: text("consumed_by_human_id").notNull().references(() => humans.id),
  grant_id: text("grant_id").references(() => catalogGrants.grant_id),
  authority_source_id: text("authority_source_id").notNull().references(() => catalogSources.source_id),
  content_source_id: text("content_source_id").notNull().references(() => catalogSources.source_id),
  package_kind: text("package_kind").notNull(),
  package_name: text("package_name").notNull(),
  package_version: text("package_version").notNull(),
  catalog_commit: text("catalog_commit").notNull(),
  package_commit: text("package_commit").notNull(),
  package_path: text("package_path").notNull(),
  package_digest: text("package_digest").notNull(),
  created_at: integer("created_at").notNull(),
}, (table) => ({
  releaseIndex: index("idx_agent_template_origins_release").on(table.release_id),
  grantIndex: index("idx_agent_template_origins_grant").on(table.grant_id),
  identityIndex: index("idx_agent_template_origins_identity").on(table.authority_source_id, table.content_source_id,
    table.package_kind, table.package_name, table.package_version, table.package_digest),
  modeCheck: check("agent_template_origins_mode_check", sql`${table.mode} IN ('CLASSIC','RLM_REPL','WRAPPED')`),
  consumedByCheck: check("agent_template_origins_consumed_by_check", sql`${table.consumed_by_kind} IN ('ADMIN','GRANT')`),
  kindCheck: check("agent_template_origins_kind_check", sql`${table.package_kind} IN ('native-agent','wrapped-agent')`),
  catalogCommitCheck: check("agent_template_origins_catalog_commit_check", sql`length(${table.catalog_commit}) BETWEEN 1 AND 64`),
  packageCommitCheck: check("agent_template_origins_package_commit_check", sql`length(${table.package_commit}) BETWEEN 1 AND 64`),
  packagePathCheck: check("agent_template_origins_package_path_check", sql`length(${table.package_path}) BETWEEN 1 AND 4096`),
  digestCheck: check("agent_template_origins_digest_check", sql`length(${table.package_digest})=71 AND substr(${table.package_digest},1,7)='sha256:' AND substr(${table.package_digest},8) NOT GLOB '*[^0-9a-f]*'`),
  grantProvenanceCheck: check("agent_template_origins_grant_provenance_check", sql`(${table.consumed_by_kind}='ADMIN' AND ${table.grant_id} IS NULL) OR (${table.consumed_by_kind}='GRANT' AND ${table.grant_id} IS NOT NULL)`),
  modeKindCheck: check("agent_template_origins_mode_kind_check", sql`(${table.package_kind}='native-agent' AND ${table.mode} IN ('CLASSIC','RLM_REPL')) OR (${table.package_kind}='wrapped-agent' AND ${table.mode}='WRAPPED')`),
}));

export const agentPackageSecretBindings = sqliteTable("agent_package_secret_bindings", {
  agent_id: text("agent_id").notNull().references(() => agents.id),
  release_id: text("release_id").notNull().references(() => catalogPackageReleases.package_release_id),
  requirement_name: text("requirement_name").notNull(),
  secret_id: text("secret_id").notNull().references(() => secrets.id),
  created_by_human_id: text("created_by_human_id").notNull().references(() => humans.id),
  revision: integer("revision").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.agent_id, table.release_id, table.requirement_name] }),
  secretIndex: index("idx_agent_package_secret_bindings_secret").on(table.secret_id),
  revisionCheck: check("agent_package_secret_bindings_revision_check", sql`${table.revision} BETWEEN 1 AND 2147483647`),
}));

export const agentSkillAssignments = sqliteTable("agent_skill_assignments", {
  assignment_id: text("assignment_id").primaryKey().notNull(),
  agent_id: text("agent_id").notNull().references(() => agents.id),
  release_id: text("release_id").notNull().references(() => catalogPackageReleases.package_release_id),
  local_skill_name: text("local_skill_name").notNull(),
  desired_state: text("desired_state").notNull(),
  effective_state: text("effective_state").notNull(),
  deployment_state: text("deployment_state").notNull(),
  removal_requested: integer("removal_requested").notNull().default(0),
  preload: integer("preload").notNull(),
  effective_preload: integer("effective_preload").notNull().default(0),
  active_generation: text("active_generation"),
  desired_generation: text("desired_generation").notNull(),
  revision: integer("revision").notNull(),
  actor_kind: text("actor_kind").notNull(),
  actor_human_id: text("actor_human_id").notNull().references(() => humans.id),
  grant_id: text("grant_id").references(() => catalogGrants.grant_id),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
}, (table) => ({
  agentSkillUnique: uniqueIndex("uidx_agent_skill_assignments_agent_name").on(table.agent_id, table.local_skill_name),
  releaseIndex: index("idx_agent_skill_assignments_release").on(table.release_id),
  deploymentIndex: index("idx_agent_skill_assignments_deployment").on(table.agent_id, table.deployment_state),
  removalIndex: index("idx_agent_skill_assignments_removal").on(table.agent_id, table.removal_requested),
  desiredCheck: check("agent_skill_assignments_desired_check", sql`${table.desired_state} IN ('DISABLED','ENABLED')`),
  effectiveCheck: check("agent_skill_assignments_effective_check", sql`${table.effective_state} IN ('DISABLED','ENABLED')`),
  deploymentCheck: check("agent_skill_assignments_deployment_check", sql`${table.deployment_state} IN ('STABLE','REQUESTED','DEPLOYING','FAILED')`),
  preloadCheck: check("agent_skill_assignments_preload_check", sql`${table.preload} IN (0,1)`),
  removalCheck: check("agent_skill_assignments_removal_check", sql`${table.removal_requested} IN (0,1)`),
  effectivePreloadCheck: check("agent_skill_assignments_effective_preload_check", sql`${table.effective_preload} IN (0,1)`),
  revisionCheck: check("agent_skill_assignments_revision_check", sql`${table.revision} BETWEEN 1 AND 2147483647`),
  actorCheck: check("agent_skill_assignments_actor_check", sql`${table.actor_kind} IN ('ADMIN','GRANT')`),
  provenanceCheck: check("agent_skill_assignments_provenance_check", sql`(${table.actor_kind}='ADMIN' AND ${table.grant_id} IS NULL) OR (${table.actor_kind}='GRANT' AND ${table.grant_id} IS NOT NULL)`),
  generationCheck: check("agent_skill_assignments_generation_check", sql`(${table.deployment_state}='STABLE' AND ${table.active_generation}=${table.desired_generation}) OR ${table.deployment_state}<>'STABLE'`),
}));

export const catalogRollouts = sqliteTable("catalog_rollouts", {
  rollout_id: text("rollout_id").primaryKey().notNull(),
  release_id: text("release_id").notNull().references(() => catalogPackageReleases.package_release_id),
  operation: text("operation").notNull(),
  preload: integer("preload"),
  plan_digest: text("plan_digest").notNull().unique(),
  state: text("state").notNull(),
  actor_kind: text("actor_kind").notNull(),
  actor_human_id: text("actor_human_id").notNull().references(() => humans.id),
  revision: integer("revision").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
  completed_at: integer("completed_at"),
}, (table) => ({
  releaseIndex: index("idx_catalog_rollouts_release_created").on(table.release_id, table.created_at),
  operationCheck: check("catalog_rollouts_operation_check", sql`${table.operation} IN ('ENABLE','DISABLE','SET_PRELOAD')`),
  preloadValueCheck: check("catalog_rollouts_preload_value_check", sql`${table.preload} IN (0,1)`),
  stateCheck: check("catalog_rollouts_state_check", sql`${table.state} IN ('DRAFT','QUEUED','RUNNING','SUCCEEDED','PARTIAL','FAILED','CANCELLED')`),
  actorCheck: check("catalog_rollouts_actor_check", sql`${table.actor_kind} IN ('ADMIN','GRANT')`),
  revisionCheck: check("catalog_rollouts_revision_check", sql`${table.revision} BETWEEN 1 AND 2147483647`),
  operationPreloadCheck: check("catalog_rollouts_operation_preload_check", sql`(${table.operation}='SET_PRELOAD' AND ${table.preload} IS NOT NULL) OR (${table.operation}<>'SET_PRELOAD' AND ${table.preload} IS NULL)`),
}));

export const catalogRolloutTargets = sqliteTable("catalog_rollout_targets", {
  rollout_id: text("rollout_id").notNull().references(() => catalogRollouts.rollout_id),
  agent_id: text("agent_id").notNull().references(() => agents.id),
  captured_runner_id: text("captured_runner_id").references(() => runnerNodes.id),
  target_ordinal: integer("target_ordinal").notNull().default(0),
  expected_assignment_revision: integer("expected_assignment_revision").notNull(),
  planned_preload: integer("planned_preload").notNull().default(0),
  state: text("state").notNull(),
  attempts: integer("attempts").notNull(),
  reason_code: text("reason_code"),
  blocker_json: text("blocker_json"),
  prior_assignment_json: text("prior_assignment_json"),
  revision: integer("revision").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
  completed_at: integer("completed_at"),
}, (table) => ({
  pk: primaryKey({ columns: [table.rollout_id, table.agent_id] }),
  ordinalUnique: uniqueIndex("uidx_catalog_rollout_targets_ordinal").on(table.rollout_id, table.target_ordinal),
  runnerStateIndex: index("idx_catalog_rollout_targets_runner_state").on(table.captured_runner_id, table.state),
  agentIndex: index("idx_catalog_rollout_targets_agent").on(table.agent_id, table.updated_at),
  ordinalCheck: check("catalog_rollout_targets_ordinal_check", sql`${table.target_ordinal} BETWEEN 0 AND 255`),
  expectedRevisionCheck: check("catalog_rollout_targets_expected_revision_check", sql`${table.expected_assignment_revision} BETWEEN 0 AND 2147483647`),
  plannedPreloadCheck: check("catalog_rollout_targets_planned_preload_check", sql`${table.planned_preload} IN (0,1)`),
  stateCheck: check("catalog_rollout_targets_state_check", sql`${table.state} IN ('QUEUED','BLOCKED','STAGING','VERIFYING','WAITING_FOR_IDLE','ACTIVATING','SUCCEEDED','FAILED','SKIPPED','SUPERSEDED')`),
  attemptsCheck: check("catalog_rollout_targets_attempts_check", sql`${table.attempts} BETWEEN 0 AND 2147483647`),
  reasonCheck: check("catalog_rollout_targets_reason_check", sql`${table.reason_code} IS NULL OR ${table.reason_code} IN ('FORBIDDEN','REVISION_CONFLICT','STATE_CONFLICT','GRANT_REQUIRED','INSTALLATION_REQUIRED','DEPLOYMENT_REQUIRED','API_ACTIVATION_REQUIRED','SECRET_BINDING_MISSING','RUNNER_BINDING_MISSING','MODEL_BINDING_MISSING','WORKSPACE_BINDING_MISSING','WRAPPED_WIRING_MISSING','QUARANTINED','REQUIREMENTS_UNSATISFIED','DEPLOYMENT_SUPERSEDED','INSPECTION_FAILED','STORAGE_FAILURE')`),
  blockerJsonCheck: check("catalog_rollout_targets_blocker_json_check", sql`${table.blocker_json} IS NULL OR (length(CAST(${table.blocker_json} AS BLOB)) <= 16384 AND json_valid(${table.blocker_json}))`),
  priorAssignmentJsonCheck: check("catalog_rollout_targets_prior_assignment_json_check", sql`${table.prior_assignment_json} IS NULL OR (length(CAST(${table.prior_assignment_json} AS BLOB)) <= 16384 AND json_valid(${table.prior_assignment_json}))`),
  revisionCheck: check("catalog_rollout_targets_revision_check", sql`${table.revision} BETWEEN 1 AND 2147483647`),
}));

export const runnerPackageDeployments = sqliteTable("runner_package_deployments", {
  deployment_id: text("deployment_id").primaryKey().notNull(),
  rollout_id: text("rollout_id").references(() => catalogRollouts.rollout_id),
  target_agent_id: text("target_agent_id").notNull().references(() => agents.id),
  release_id: text("release_id").notNull().references(() => catalogPackageReleases.package_release_id),
  bound_runner_id: text("bound_runner_id").notNull().references(() => runnerNodes.id),
  desired_generation: text("desired_generation").notNull(),
  state: text("state").notNull(),
  attempt_token: text("attempt_token"),
  lease_expires_at: integer("lease_expires_at"),
  revision: integer("revision").notNull(),
  failure_code: text("failure_code"),
  desired_roots_json: text("desired_roots_json"),
  package_set_digest: text("package_set_digest"),
  artifact_semantic_digest: text("artifact_semantic_digest"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
  completed_at: integer("completed_at"),
}, (table) => ({
  agentGenerationUnique: uniqueIndex("uidx_runner_package_deployments_agent_generation").on(table.target_agent_id, table.desired_generation),
  pollIndex: index("idx_runner_package_deployments_poll").on(table.bound_runner_id, table.state, table.created_at),
  agentIndex: index("idx_runner_package_deployments_agent").on(table.target_agent_id, table.updated_at),
  liveAgentUnique: uniqueIndex("uidx_runner_package_deployments_live_agent").on(table.target_agent_id).where(sql`${table.state} IN ('QUEUED','CLAIMED','STAGED','WAITING_FOR_IDLE')`),
  stateCheck: check("runner_package_deployments_state_check", sql`${table.state} IN ('QUEUED','CLAIMED','STAGED','WAITING_FOR_IDLE','ACTIVE','FAILED','SUPERSEDED')`),
  revisionCheck: check("runner_package_deployments_revision_check", sql`${table.revision} BETWEEN 1 AND 2147483647`),
  failureCodeCheck: check("runner_package_deployments_failure_code_check", sql`${table.failure_code} IS NULL OR ${table.failure_code} IN ('DEPLOYMENT_SUPERSEDED','INSPECTION_FAILED','STORAGE_FAILURE')`),
  attemptCheck: check("runner_package_deployments_attempt_check", sql`(${table.state} IN ('CLAIMED','STAGED','WAITING_FOR_IDLE') AND ${table.attempt_token} IS NOT NULL) OR ${table.state} NOT IN ('CLAIMED','STAGED','WAITING_FOR_IDLE')`),
  failedCodeCheck: check("runner_package_deployments_failed_code_check", sql`(${table.state}='FAILED' AND ${table.failure_code} IS NOT NULL) OR ${table.state}<>'FAILED'`),
  rootsJsonCheck: check("runner_package_deployments_roots_json_check", sql`${table.desired_roots_json} IS NULL OR (json_valid(${table.desired_roots_json}) AND length(CAST(${table.desired_roots_json} AS BLOB))<=262144)`),
  packageSetDigestCheck: check("runner_package_deployments_package_set_digest_check", sql`${table.package_set_digest} IS NULL OR (length(${table.package_set_digest})=71 AND substr(${table.package_set_digest},1,7)='sha256:' AND substr(${table.package_set_digest},8) NOT GLOB '*[^0-9a-f]*')`),
  artifactDigestCheck: check("runner_package_deployments_artifact_digest_check", sql`${table.artifact_semantic_digest} IS NULL OR (length(${table.artifact_semantic_digest})=71 AND substr(${table.artifact_semantic_digest},1,7)='sha256:' AND substr(${table.artifact_semantic_digest},8) NOT GLOB '*[^0-9a-f]*')`),
}));

export const runnerDeploymentParticipants = sqliteTable("runner_deployment_participants", {
  deployment_id: text("deployment_id").notNull().references(() => runnerPackageDeployments.deployment_id, { onDelete: "cascade" }),
  assignment_id: text("assignment_id").notNull().references(() => agentSkillAssignments.assignment_id),
  agent_id: text("agent_id").notNull().references(() => agents.id),
  release_id: text("release_id").notNull().references(() => catalogPackageReleases.package_release_id),
  local_skill_name: text("local_skill_name").notNull(),
  role: text("role").notNull(),
  target_state: text("target_state").notNull(),
  target_preload: integer("target_preload").notNull(),
  prior_effective_state: text("prior_effective_state").notNull(),
  prior_effective_preload: integer("prior_effective_preload").notNull(),
  prior_active_generation: text("prior_active_generation"),
  assignment_revision: integer("assignment_revision").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.deployment_id, table.assignment_id] }),
  deploymentNameUnique: uniqueIndex("uidx_runner_deployment_participants_name").on(table.deployment_id, table.local_skill_name),
  assignmentIndex: index("idx_runner_deployment_participants_assignment").on(table.assignment_id, table.deployment_id),
  agentIndex: index("idx_runner_deployment_participants_agent").on(table.agent_id, table.deployment_id),
  roleCheck: check("runner_deployment_participants_role_check", sql`${table.role} IN ('APPLY_DESIRED','CARRY_EFFECTIVE')`),
  targetStateCheck: check("runner_deployment_participants_target_state_check", sql`${table.target_state} IN ('DISABLED','ENABLED')`),
  targetPreloadCheck: check("runner_deployment_participants_target_preload_check", sql`${table.target_preload} IN (0,1)`),
  effectiveStateCheck: check("runner_deployment_participants_effective_state_check", sql`${table.prior_effective_state} IN ('DISABLED','ENABLED')`),
  effectivePreloadCheck: check("runner_deployment_participants_effective_preload_check", sql`${table.prior_effective_preload} IN (0,1)`),
  targetDisabledPreloadCheck: check("runner_deployment_participants_target_disabled_preload_check", sql`(${table.target_state}='ENABLED') OR ${table.target_preload}=0`),
  effectiveDisabledPreloadCheck: check("runner_deployment_participants_effective_disabled_preload_check", sql`(${table.prior_effective_state}='ENABLED') OR ${table.prior_effective_preload}=0`),
  revisionCheck: check("runner_deployment_participants_revision_check", sql`${table.assignment_revision} BETWEEN 1 AND 2147483647`),
}));

export const catalogSourcesLegacy032 = sqliteTable("catalog_sources_legacy_032", {
  source_id: text("source_id").primaryKey().notNull(),
  canonical_url: text("canonical_url").notNull(),
  ssh_user: text("ssh_user"),
  repository_identity: text("repository_identity").notNull().unique(),
  enabled: integer("enabled").notNull(),
  allow_packages: integer("allow_packages").notNull(),
  revision: integer("revision").notNull(),
  removed_at: integer("removed_at"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});
export const catalogsLegacy032 = sqliteTable("catalogs_legacy_032", {
  catalog_id: text("catalog_id").primaryKey().notNull(),
  source_id: text("source_id").notNull(),
  display_name: text("display_name").notNull(),
  ref: text("ref").notNull(),
  enabled: integer("enabled").notNull(),
  revision: integer("revision").notNull(),
  removed_at: integer("removed_at"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});
export const catalogReadCredentialsLegacy032 = sqliteTable("catalog_read_credentials_legacy_032", {
  source_id: text("source_id").primaryKey().notNull(),
  credential_ref: text("credential_ref").notNull().unique(),
  kind: text("kind").notNull(),
  ciphertext_b64: text("ciphertext_b64").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const catalogInstalledOrigins = sqliteTable("catalog_installed_origins", {
  name: text("name").primaryKey(),
  catalog_id: text("catalog_id").notNull(),
  source_id: text("source_id").notNull(),
  catalog_commit: text("catalog_commit").notNull(),
  package_commit: text("package_commit").notNull(),
  path: text("path").notNull(),
  kind: text("kind").notNull(),
  version: text("version").notNull(),
  digest: text("digest").notNull(),
  local_path: text("local_path").notNull(),
  installed_by_human_id: text("installed_by_human_id"),
  installed_at: integer("installed_at").notNull(),
}, (table) => ({
  kindCheck: check("catalog_installed_origins_kind_check", sql`${table.kind}='skill'`),
  catalogIndex: index("idx_catalog_installed_origins_catalog").on(table.catalog_id, table.name, table.version),
}));

export const schema = {
  catalogSources,
  catalogSourceReadCredentials,
  catalogSyncAttempts,
  catalogSnapshots,
  catalogPackageReleases,
  catalogSnapshotEntries,
  catalogReleaseControls,
  catalogGrants,
  catalogInstallOperations,
  catalogInstallations,
  catalogApiActivations,
  agentTemplateOrigins,
  agentPackageSecretBindings,
  agentSkillAssignments,
  catalogRollouts,
  catalogRolloutTargets,
  runnerPackageDeployments,
  runnerDeploymentParticipants,
  catalogSourcesLegacy032,
  catalogsLegacy032,
  catalogReadCredentialsLegacy032,
  // Compatibility property names point at the retained migration-032 archives.
  catalogs: catalogsLegacy032,
  catalogReadCredentials: catalogReadCredentialsLegacy032,
  catalogInstalledOrigins,
  migrations,
  agents,
  runnerNodes,
  teams,
  humans,
  integrationKeys,
  agentInvites,
  runnerTokens,
  teamMemberships,
  channels,
  channelSubscriptions,
  channelViewers,
  channelShareLinks,
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
  embedConversations
};

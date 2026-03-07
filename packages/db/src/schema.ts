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
  desired_state: text("desired_state").notNull().default("RUNNING"),
  runtime_state: text("runtime_state").notNull().default("STOPPED"),
  last_heartbeat_at: integer("last_heartbeat_at"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
  enabled_skills_json: text("enabled_skills_json").notNull().default("[]")
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

export const webhookDefinitions = sqliteTable("webhook_definitions", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  verification_kind: text("verification_kind").notNull(),
  secret: text("secret").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull()
});

export const schema = {
  migrations,
  agents,
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
  webhookDefinitions
};

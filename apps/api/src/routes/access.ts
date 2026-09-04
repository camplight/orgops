import {
  AGENT_VISIBILITY,
  CHANNEL_VISIBILITY,
  schema,
  type AgentVisibility,
  type ChannelVisibility,
  type OrgOpsDrizzleDb,
} from "@orgops/db";
import { and, eq, inArray } from "drizzle-orm";

export type RequestUser = {
  id?: string;
  username?: string;
  mustChangePassword?: boolean;
};

type AccessDeps = {
  orm: OrgOpsDrizzleDb;
};

function isRunnerUser(user: RequestUser | undefined): boolean {
  return user?.username === "runner";
}

function isHumanUser(user: RequestUser | undefined): user is RequestUser & { username: string } {
  return Boolean(user?.username && user.username !== "runner");
}

type ChannelAccessRow = {
  id: string;
  visibility: string | null;
  ownerHumanId: string | null;
};

type AgentAccessRow = {
  visibility: string | null;
  ownerHumanId: string | null;
};

function normalizeChannelVisibility(value: unknown): ChannelVisibility {
  return value === CHANNEL_VISIBILITY.PRIVATE
    ? CHANNEL_VISIBILITY.PRIVATE
    : CHANNEL_VISIBILITY.PUBLIC;
}

function normalizeAgentVisibility(value: unknown): AgentVisibility {
  return value === AGENT_VISIBILITY.PRIVATE
    ? AGENT_VISIBILITY.PRIVATE
    : AGENT_VISIBILITY.PUBLIC;
}

export function createAccessControl(deps: AccessDeps) {
  const { orm } = deps;

  function listViewerTeamIds(user: RequestUser | undefined): string[] {
    if (!isHumanUser(user)) return [];
    return orm
      .select({ teamId: schema.teamMemberships.team_id })
      .from(schema.teamMemberships)
      .where(
        and(
          eq(schema.teamMemberships.member_type, "HUMAN"),
          eq(schema.teamMemberships.member_id, user.username),
        ),
      )
      .all()
      .map((row) => row.teamId);
  }

  function getChannel(channelId: string): ChannelAccessRow | undefined {
    return orm
      .select({
        id: schema.channels.id,
        visibility: schema.channels.visibility,
        ownerHumanId: schema.channels.owner_human_id,
      })
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .get() as ChannelAccessRow | undefined;
  }

  function getAgent(agentName: string): AgentAccessRow | undefined {
    return orm
      .select({
        visibility: schema.agents.visibility,
        ownerHumanId: schema.agents.owner_human_id,
      })
      .from(schema.agents)
      .where(eq(schema.agents.name, agentName))
      .get() as AgentAccessRow | undefined;
  }

  function canViewChannel(user: RequestUser | undefined, channelId: string): boolean {
    const channel = getChannel(channelId);
    // Legacy channel-less integrations have historically emitted arbitrary
    // channel ids before rows existed. Treat unknown ids as public legacy ids.
    if (!channel) return true;
    if (isRunnerUser(user)) return true;

    const visibility = normalizeChannelVisibility(channel.visibility);
    if (visibility === CHANNEL_VISIBILITY.PUBLIC) return true;
    if (!isHumanUser(user)) return false;
    if (channel.ownerHumanId && user.id && channel.ownerHumanId === user.id) return true;

    const member = orm
      .select({ channelId: schema.channelSubscriptions.channel_id })
      .from(schema.channelSubscriptions)
      .where(
        and(
          eq(schema.channelSubscriptions.channel_id, channelId),
          eq(schema.channelSubscriptions.subscriber_type, "HUMAN"),
          eq(schema.channelSubscriptions.subscriber_id, user.username),
        ),
      )
      .get();
    if (member) return true;
    const teamIds = listViewerTeamIds(user);
    if (teamIds.length === 0) return false;
    const teamMember = orm
      .select({ channelId: schema.channelSubscriptions.channel_id })
      .from(schema.channelSubscriptions)
      .where(
        and(
          eq(schema.channelSubscriptions.channel_id, channelId),
          eq(schema.channelSubscriptions.subscriber_type, "TEAM"),
          inArray(schema.channelSubscriptions.subscriber_id, teamIds),
        ),
      )
      .get();
    return Boolean(teamMember);
  }

  function canManageChannel(user: RequestUser | undefined, channelId: string): boolean {
    const channel = getChannel(channelId);
    // Preserve idempotent delete/update behavior for missing legacy channel ids.
    if (!channel) return true;
    if (isRunnerUser(user)) return true;
    const visibility = normalizeChannelVisibility(channel.visibility);
    if (visibility === CHANNEL_VISIBILITY.PUBLIC) return true;
    if (!isHumanUser(user) || !user.id || !channel.ownerHumanId) return false;
    return user.id === channel.ownerHumanId;
  }

  function canPostToChannel(user: RequestUser | undefined, channelId: string): boolean {
    const channel = getChannel(channelId);
    if (!channel) return true;
    return canViewChannel(user, channelId);
  }

  function listVisibleChannelIds(user: RequestUser | undefined): string[] {
    if (isRunnerUser(user)) {
      return orm
        .select({ id: schema.channels.id })
        .from(schema.channels)
        .all()
        .map((row) => row.id);
    }
    if (!isHumanUser(user)) return [];
    const channels = orm
      .select({
        id: schema.channels.id,
        visibility: schema.channels.visibility,
        ownerHumanId: schema.channels.owner_human_id,
      })
      .from(schema.channels)
      .all() as Array<{
      id: string;
      visibility: string | null;
      ownerHumanId: string | null;
    }>;
    const visible = new Set<string>();
    const privateIds: string[] = [];
    for (const channel of channels) {
      const visibility = normalizeChannelVisibility(channel.visibility);
      if (visibility === CHANNEL_VISIBILITY.PUBLIC) {
        visible.add(channel.id);
      } else if (channel.ownerHumanId && user.id && channel.ownerHumanId === user.id) {
        visible.add(channel.id);
      } else {
        privateIds.push(channel.id);
      }
    }
    if (privateIds.length > 0) {
      const humanSubs = orm
        .select({ channelId: schema.channelSubscriptions.channel_id })
        .from(schema.channelSubscriptions)
        .where(
          and(
            eq(schema.channelSubscriptions.subscriber_type, "HUMAN"),
            eq(schema.channelSubscriptions.subscriber_id, user.username),
            inArray(schema.channelSubscriptions.channel_id, privateIds),
          ),
        )
        .all();
      for (const row of humanSubs) visible.add(row.channelId);

      const viewerTeamIds = listViewerTeamIds(user);
      if (viewerTeamIds.length > 0) {
        const teamSubs = orm
          .select({
            channelId: schema.channelSubscriptions.channel_id,
            teamId: schema.channelSubscriptions.subscriber_id,
          })
          .from(schema.channelSubscriptions)
          .where(
            and(
              eq(schema.channelSubscriptions.subscriber_type, "TEAM"),
              inArray(schema.channelSubscriptions.channel_id, privateIds),
            ),
          )
          .all();
        const teamSet = new Set(viewerTeamIds);
        for (const row of teamSubs) {
          if (teamSet.has(row.teamId)) visible.add(row.channelId);
        }
      }
    }
    return [...visible];
  }

  function canViewAgent(user: RequestUser | undefined, agentName: string): boolean {
    const agent = getAgent(agentName);
    // Runners write/read memory for agents during bootstrap before a full row
    // may exist in tests and legacy integrations.
    if (!agent) return isRunnerUser(user);
    if (isRunnerUser(user)) return true;
    const visibility = normalizeAgentVisibility(agent.visibility);
    if (visibility === AGENT_VISIBILITY.PUBLIC) return true;
    if (!isHumanUser(user)) return false;
    if (agent.ownerHumanId && user.id && agent.ownerHumanId === user.id) return true;

    const shared = orm
      .select({ channelId: schema.channelSubscriptions.channel_id })
      .from(schema.channelSubscriptions)
      .where(
        and(
          eq(schema.channelSubscriptions.subscriber_type, "AGENT"),
          eq(schema.channelSubscriptions.subscriber_id, agentName),
        ),
      )
      .all()
      .map((row) => row.channelId);
    if (shared.length === 0) return false;
    const humanSub = orm
      .select({ channelId: schema.channelSubscriptions.channel_id })
      .from(schema.channelSubscriptions)
      .where(
        and(
          eq(schema.channelSubscriptions.subscriber_type, "HUMAN"),
          eq(schema.channelSubscriptions.subscriber_id, user.username),
          inArray(schema.channelSubscriptions.channel_id, shared),
        ),
      )
      .get();
    if (humanSub) return true;
    const viewerTeamIds = listViewerTeamIds(user);
    if (viewerTeamIds.length === 0) return false;
    const teamSub = orm
      .select({ channelId: schema.channelSubscriptions.channel_id })
      .from(schema.channelSubscriptions)
      .where(
        and(
          eq(schema.channelSubscriptions.subscriber_type, "TEAM"),
          inArray(schema.channelSubscriptions.subscriber_id, viewerTeamIds),
          inArray(schema.channelSubscriptions.channel_id, shared),
        ),
      )
      .get();
    return Boolean(teamSub);
  }

  function canManageAgent(user: RequestUser | undefined, agentName: string): boolean {
    if (isRunnerUser(user)) return true;
    if (!isHumanUser(user)) return false;
    const agent = getAgent(agentName);
    if (!agent) return false;
    const visibility = normalizeAgentVisibility(agent.visibility);
    // Public existing agents do not have owners because this rollout has no backfill.
    if (visibility === AGENT_VISIBILITY.PUBLIC) return true;
    return Boolean(agent.ownerHumanId && user.id && agent.ownerHumanId === user.id);
  }

  return {
    canViewChannel,
    canManageChannel,
    canPostToChannel,
    listVisibleChannelIds,
    canViewAgent,
    canManageAgent,
  };
}

export type AccessControl = ReturnType<typeof createAccessControl>;

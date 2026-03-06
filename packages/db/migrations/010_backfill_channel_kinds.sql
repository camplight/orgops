-- Backfill integration bridge channels to explicit kind.
UPDATE channels
SET kind = 'INTEGRATION_BRIDGE'
WHERE kind = 'GROUP'
  AND lower(coalesce(description, '')) LIKE '%bridge channel%';

-- Backfill legacy direct channels that may still be GROUP.
UPDATE channels
SET kind = CASE
  WHEN (
    SELECT COUNT(*)
    FROM channel_subscriptions AS cs
    WHERE cs.channel_id = channels.id
      AND cs.subscriber_type = 'HUMAN'
  ) = 1
   AND (
    SELECT COUNT(*)
    FROM channel_subscriptions AS cs
    WHERE cs.channel_id = channels.id
      AND cs.subscriber_type = 'AGENT'
  ) = 1
   AND (
    SELECT COUNT(*)
    FROM channel_subscriptions AS cs
    WHERE cs.channel_id = channels.id
  ) = 2
    THEN 'HUMAN_AGENT_DM'
  WHEN (
    SELECT COUNT(*)
    FROM channel_subscriptions AS cs
    WHERE cs.channel_id = channels.id
      AND cs.subscriber_type = 'HUMAN'
  ) = 0
   AND (
    SELECT COUNT(*)
    FROM channel_subscriptions AS cs
    WHERE cs.channel_id = channels.id
      AND cs.subscriber_type = 'AGENT'
  ) = 2
   AND (
    SELECT COUNT(*)
    FROM channel_subscriptions AS cs
    WHERE cs.channel_id = channels.id
  ) = 2
    THEN 'AGENT_AGENT_DM'
  ELSE 'DIRECT_GROUP'
END
WHERE kind = 'GROUP'
  AND (
    direct_participant_key IS NOT NULL
    OR name LIKE 'direct-%'
  );

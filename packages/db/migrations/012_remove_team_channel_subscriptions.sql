-- Channel delivery is agent-subscriber only.
DELETE FROM channel_subscriptions
WHERE subscriber_type = 'TEAM';

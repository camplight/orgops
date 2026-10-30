-- Keep restart-boundary lookups independent of historical tool output volume.
CREATE INDEX IF NOT EXISTS idx_events_lifecycle
ON events(type, source, created_at)
WHERE type IN ('agent.lifecycle.started', 'wrapper.lifecycle.started');

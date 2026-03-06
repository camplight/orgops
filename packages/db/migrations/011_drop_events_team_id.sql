-- team_id is no longer part of the event transport model.
ALTER TABLE events DROP COLUMN team_id;

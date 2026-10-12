-- Google onboarding originally used a lowercase type and human UUID, while
-- engine team authorization requires uppercase HUMAN and the human username.
-- Repair only memberships tied to a stored Google identity, preserving the team.
INSERT OR IGNORE INTO team_memberships (team_id, member_type, member_id)
SELECT memberships.team_id, 'HUMAN', humans.username
FROM team_memberships AS memberships
JOIN humans ON humans.id = memberships.member_id
JOIN human_identities AS identities ON identities.human_id = humans.id
WHERE memberships.member_type = 'human' AND identities.provider = 'google';

DELETE FROM team_memberships
WHERE member_type = 'human' AND member_id IN (
  SELECT human_id FROM human_identities WHERE provider = 'google'
);

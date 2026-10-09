CREATE TABLE human_identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  human_id TEXT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  hosted_domain TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject),
  UNIQUE (provider, human_id)
);
CREATE TABLE google_auth_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  allowed_domain TEXT NOT NULL,
  team_name TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

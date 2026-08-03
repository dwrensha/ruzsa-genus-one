-- Users, identified by an OAuth provider. Login sessions live in KV, not D1.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,           -- 'github' (room for more providers)
  provider_user_id TEXT NOT NULL,   -- stable id from the IdP (numeric for GitHub)
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT,
  UNIQUE (provider, provider_user_id)
);

-- API tokens: bearer credentials for the JSON API, one row per token. The
-- raw token is shown once at creation and stored only as a sha256 hash.

CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  token_hash TEXT NOT NULL UNIQUE,  -- sha256(token)
  prefix TEXT NOT NULL,             -- e.g. 'ruzsa_abcd1234' for display
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

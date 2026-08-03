-- Record witnesses, append-only: when a submission strictly exceeds the
-- previous record for its modulus, a new row is added. Superseded records
-- are kept as history; the current record for n is its row of maximal size.

CREATE TABLE IF NOT EXISTS witnesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  n INTEGER NOT NULL,
  size INTEGER NOT NULL,
  ratio REAL NOT NULL,              -- size / sqrt(n), the score to maximize
  elements TEXT NOT NULL,           -- JSON array, reduced mod n, sorted
  submitter_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_witnesses_n_size ON witnesses(n, size);
CREATE INDEX IF NOT EXISTS idx_witnesses_ratio ON witnesses(ratio DESC);

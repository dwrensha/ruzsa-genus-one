-- Editable per-witness commentary: one current text per witness, kept as an
-- append-only log of edits; the witness points at its latest entry via
-- current_comment_id. Empty content represents a "clear".

CREATE TABLE IF NOT EXISTS commentary_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  witness_id INTEGER NOT NULL REFERENCES witnesses(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,            -- '' represents a "clear" edit
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_commentary_log_witness ON commentary_log(witness_id, id);

ALTER TABLE witnesses ADD COLUMN current_comment_id INTEGER REFERENCES commentary_log(id);

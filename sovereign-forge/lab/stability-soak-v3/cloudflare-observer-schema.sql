CREATE TABLE IF NOT EXISTS v3_observer_state (
  node TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0,
  last_success_ms INTEGER,
  outage_open_ms INTEGER,
  fail_emitted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS v3_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  node TEXT,
  event TEXT NOT NULL,
  event_at_ms INTEGER NOT NULL,
  boot_id TEXT,
  seq INTEGER,
  payload_json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS v3_evidence_node_boot_seq
ON v3_evidence(node,boot_id,seq)
WHERE seq IS NOT NULL AND boot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS v3_evidence_run_event_time
ON v3_evidence(run_id,event,event_at_ms);

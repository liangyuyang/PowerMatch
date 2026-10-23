CREATE TABLE comparisons (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id),
  guest_hash TEXT,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('public','company','private')),
  latest_revision INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(owner_id IS NOT NULL OR (guest_hash IS NOT NULL AND guest_hash <> ''))
);
CREATE INDEX comparisons_scope_updated ON comparisons(scope,deleted,updated_at,id);
CREATE INDEX comparisons_owner ON comparisons(owner_id,deleted);
CREATE TABLE comparison_revisions (
  id TEXT PRIMARY KEY,
  comparison_id TEXT NOT NULL REFERENCES comparisons(id),
  number INTEGER NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('public','company','private')),
  name TEXT NOT NULL,
  locked INTEGER NOT NULL CHECK(locked IN (0,1)),
  snapshots_json TEXT NOT NULL,
  actor_key TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(comparison_id,number),
  UNIQUE(actor_key,request_id)
);
CREATE TRIGGER comparison_revisions_no_update BEFORE UPDATE ON comparison_revisions BEGIN SELECT RAISE(ABORT,'immutable-comparison-revision'); END;
CREATE TRIGGER comparison_revisions_no_delete BEFORE DELETE ON comparison_revisions BEGIN SELECT RAISE(ABORT,'immutable-comparison-revision'); END;

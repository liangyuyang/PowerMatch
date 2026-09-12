CREATE TABLE ai_models (
 id TEXT PRIMARY KEY, config_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
 is_default INTEGER NOT NULL DEFAULT 0, health TEXT NOT NULL DEFAULT 'unchecked',
 checked_at TEXT, revision INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ai_single_default ON ai_models(is_default) WHERE is_default=1;
CREATE TABLE ai_invocations (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), model_id TEXT NOT NULL,
 model_name TEXT NOT NULL, provider TEXT NOT NULL, purpose TEXT NOT NULL,
 input_tokens INTEGER, output_tokens INTEGER, estimated_cost REAL, currency TEXT,
 latency_ms INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
 error_code TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ai_usage_user_time ON ai_invocations(user_id, created_at);
CREATE TABLE ai_secrets (provider TEXT PRIMARY KEY, iv TEXT NOT NULL, ciphertext TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

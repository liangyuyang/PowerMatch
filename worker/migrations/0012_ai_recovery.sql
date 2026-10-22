-- Lease expiry closes uncertain work; it never reissues a provider request.
ALTER TABLE ai_invocations ADD COLUMN lease_token TEXT;
ALTER TABLE ai_invocations ADD COLUMN lease_expires_at TEXT;
ALTER TABLE ai_invocations ADD COLUMN request_started_at TEXT;
ALTER TABLE ai_invocations ADD COLUMN completed_at TEXT;
ALTER TABLE ai_invocations ADD COLUMN recovery_state TEXT;
ALTER TABLE ai_invocations ADD COLUMN request_id TEXT;
ALTER TABLE ai_invocations ADD COLUMN request_hash TEXT;
UPDATE ai_invocations SET lease_expires_at=datetime(created_at,'+5 minutes') WHERE status='pending';
CREATE INDEX ai_pending_lease ON ai_invocations(status,lease_expires_at);
CREATE UNIQUE INDEX ai_user_request_once ON ai_invocations(user_id,request_id) WHERE request_id IS NOT NULL;

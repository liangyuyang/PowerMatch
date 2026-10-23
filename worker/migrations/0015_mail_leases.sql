ALTER TABLE mail_outbox ADD COLUMN lease_token TEXT;
ALTER TABLE mail_outbox ADD COLUMN lease_expires_at TEXT;
ALTER TABLE mail_outbox ADD COLUMN first_attempt_at TEXT;
ALTER TABLE mail_outbox ADD COLUMN next_attempt_at TEXT;
ALTER TABLE mail_outbox ADD COLUMN payload_from TEXT;
ALTER TABLE mail_outbox ADD COLUMN payload_hash TEXT;
ALTER TABLE mail_outbox ADD COLUMN completed_at TEXT;
ALTER TABLE mail_outbox ADD COLUMN recovery_state TEXT;
CREATE INDEX mail_pending_lease ON mail_outbox(state,lease_expires_at,next_attempt_at);
-- An old sending row has neither a frozen sender nor a verifiable first-attempt
-- window. Keep its body for manual inspection; never infer a safe retry.
UPDATE mail_outbox SET state='manual-review',error_code='mail-legacy-outcome-unknown',recovery_state='legacy-not-retried'
 WHERE attempts>0 AND state IN ('pending','sending','failed');

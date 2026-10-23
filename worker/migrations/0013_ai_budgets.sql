-- Application estimates, not a provider billing guarantee. NULL retains unknown history.
ALTER TABLE ai_invocations ADD COLUMN reserved_input_tokens INTEGER CHECK(reserved_input_tokens>=0);
ALTER TABLE ai_invocations ADD COLUMN reserved_output_tokens INTEGER CHECK(reserved_output_tokens>=0);
ALTER TABLE ai_invocations ADD COLUMN budget_tokens INTEGER CHECK(budget_tokens>=0);
ALTER TABLE ai_invocations ADD COLUMN budget_cny REAL CHECK(budget_cny>=0);
UPDATE ai_invocations SET budget_tokens=input_tokens+output_tokens
  WHERE input_tokens IS NOT NULL AND output_tokens IS NOT NULL;
UPDATE ai_invocations SET budget_cny=cost_cny WHERE cost_cny IS NOT NULL;
CREATE INDEX ai_budget_user_time ON ai_invocations(user_id,created_at);

UPDATE ai_models
SET is_default=1
WHERE id=(SELECT id FROM ai_models WHERE enabled=1 AND health='ok' ORDER BY checked_at,id LIMIT 1)
  AND NOT EXISTS(SELECT 1 FROM ai_models WHERE is_default=1);

// Longer than the provider's 55s deadline, leaving time to persist the result.
export const AI_LEASE_SECONDS = 120;
export const AI_IN_FLIGHT_LIMITS = { user: 2, total: 20 } as const;

export function expiredAIDiagnostic(invocationId: string) {
  return {
    code: "ai-lease-expired",
    stage: "recovery",
    message: "调用租约已过期，供应商最终结果可能未知；已保留收到的用量及原调用者记录。",
    suggestion: "此调用不会自动重发。请在供应商账单核对未知用量；重新发起调用可能再次计费。",
    invocationId,
  };
}

export async function aiRecoveryStats(db: D1Database) {
  return db.prepare(`SELECT COUNT(*) calls,
    COALESCE(SUM(status='pending'),0) pending,
    COALESCE(SUM(status='pending' AND lease_expires_at<=CURRENT_TIMESTAMP),0) expired,
    COALESCE(SUM(status='pending' AND lease_expires_at>CURRENT_TIMESTAMP),0) active,
    COALESCE(SUM(recovery_state IS NOT NULL),0) recovered,
    COALESCE(SUM(recovery_state IS NOT NULL AND (input_tokens IS NULL OR output_tokens IS NULL)),0) recovered_unknown_usage,
    COALESCE(SUM(status='failed' AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL),0) failures_with_known_usage
    FROM ai_invocations`).first();
}

export async function recoverExpiredAIInvocations(db: D1Database, includeStats = true) {
  // One conditional write: a concurrent completion and recovery cannot both win.
  // Keep tokens, cost and snapshot untouched, including null (unknown) values.
  const result = await db.prepare(`UPDATE ai_invocations SET status='failed',
    error_code='ai-lease-expired',completed_at=CURRENT_TIMESTAMP,
    recovery_state='closed-without-retry',
    diagnostic_json=json_object('code','ai-lease-expired','stage','recovery',
      'message','调用租约已过期，供应商最终结果可能未知；已保留收到的用量及原调用者记录。',
      'suggestion','此调用不会自动重发。请在供应商账单核对未知用量；重新发起调用可能再次计费。',
      'invocationId',id)
    WHERE status='pending' AND lease_expires_at<=CURRENT_TIMESTAMP`).run();
  return { recovered: result.meta.changes, stats: includeStats ? await aiRecoveryStats(db) : null, automaticRetry: false };
}

import { budgetScopes, costCny, estimateCost, type AIBilling, type AIConfig } from "../src/shared/ai-config";

export const AI_MAX_OUTPUT_TOKENS = 4096;
export function reserveAIUsage(config: AIConfig, messages: { role: string; content: string }[], usdToCny: number | null) {
  // Byte-based conservative application estimate, including a framing allowance.
  // Tokenizers, hidden provider reasoning and billing rules can differ; this is
  // deliberately not advertised as an exact provider spend or tokenizer bound.
  const input = new TextEncoder().encode(JSON.stringify(messages)).length + 1024 + messages.length * 64;
  const output = AI_MAX_OUTPUT_TOKENS;
  return { input, output, tokens: input + output, cny: costCny(estimateCost(config, input, output), config.currency, usdToCny) };
}
export function hasCnyBudget(billing: AIBilling) {
  return budgetScopes.some(scope => billing.budgets[scope].cny !== null);
}
export function budgetPredicate(billing: AIBilling, userId: string, reservation: ReturnType<typeof reserveAIUsage>) {
  const clauses: string[] = [];
  const bindings: (number | string | null)[] = [];
  for (const scope of budgetScopes) {
    const where = `created_at >= datetime('now','+8 hours','start of ${scope.endsWith("Month") ? "month" : "day"}','-8 hours')${scope.startsWith("user") ? " AND user_id=?" : ""}`;
    for (const [field, amount, limit] of [
      ["budget_tokens", reservation.tokens, billing.budgets[scope].tokens],
      ["budget_cny", reservation.cny, billing.budgets[scope].cny],
    ] as const) {
      if (limit === null) continue;
      // Unknown historical values must not disappear from SUM as if free.
      clauses.push(`NOT EXISTS(SELECT 1 FROM ai_invocations WHERE ${where} AND ${field} IS NULL) AND (SELECT COALESCE(SUM(${field}),0) FROM ai_invocations WHERE ${where}) + ? <= ?`);
      if (scope.startsWith("user")) bindings.push(userId, userId);
      bindings.push(amount, limit);
    }
  }
  return { sql: clauses.length ? clauses.join(" AND ") : "1=1", bindings };
}

export function reconcileAIBudget(config: AIConfig, usdToCny: number | null, reserved: ReturnType<typeof reserveAIUsage>, input: number | null, output: number | null, cny: number | null) {
  const guardedInput = input ?? reserved.input, guardedOutput = output ?? reserved.output;
  // Partial reports can already exceed the original estimate. Price known
  // components plus the still-reserved unknown component using admission rates.
  const partialEstimate = costCny(estimateCost(config, guardedInput, guardedOutput), config.currency, usdToCny);
  return { tokens: guardedInput + guardedOutput, cny: cny ?? partialEstimate ?? reserved.cny };
}

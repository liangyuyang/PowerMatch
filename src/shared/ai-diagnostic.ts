export interface AIDiagnostic {
  code: string;
  stage: string;
  message: string;
  suggestion: string;
  httpStatus?: number;
  providerCode?: string;
  requestId?: string;
  endpoint?: string;
  model?: string;
  invocationId?: string;
  checkedAt?: string;
}
export class AIRequestError extends Error {
  constructor(public detail: AIDiagnostic) {
    super(detail.code);
    this.name = "AIRequestError";
  }
}
export function redact(value: unknown, key = "") {
  let s = String(value ?? "");
  if (key) s = s.split(key).join("[REDACTED]");
  return s
    .replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk-|AIza)[\w-]+/g, "[REDACTED]")
    .replace(
      /((?:api[_ -]?key|authorization|token|password)\s*[=:]\s*["']?)[^\s,"'<>]+/gi,
      "$1[REDACTED]",
    )
    .replace(/[\u0000-\u001f]/g, " ")
    .slice(0, 800);
}
export function diagnosticFor(
  e: unknown,
  stage: string,
  key = "",
): AIDiagnostic {
  if (e instanceof AIRequestError) return e.detail;
  const name = e instanceof Error ? e.name : "Error",
    message = redact(e instanceof Error ? e.message : "Unknown error", key);
  if (stage === "key")
    return {
      code: "key-read-failed",
      stage,
      message: `密钥读取或解密失败（${name}）。`,
      suggestion: "请重新保存此模型的 API Key；不要更换应用加密主密钥。",
    };
  if (name === "TimeoutError" || name === "AbortError")
    return {
      code: "provider-timeout",
      stage,
      message: "供应商请求超过 55 秒或连接被中断。",
      suggestion: "稍后重试；检查供应商状态、模型响应速度和接口地址。",
    };
  return {
    code:
      stage === "request"
        ? "provider-network-error"
        : stage === "validate"
          ? "invalid-ai-proposal"
          : stage === "storage"
            ? "ai-storage-error"
            : "ai-request-failed",
    stage,
    message: `${name}: ${message}`,
    suggestion:
      stage === "request"
        ? "检查 Base URL、网络连通性及 API Key 是否包含换行或非法字符。"
        : stage === "validate"
          ? "供应商已回复，但内容不符合所需格式；重试或切换模型。"
          : "请复制诊断信息，以请求编号定位服务端记录。",
  };
}
export function httpDiagnostic(
  status: number,
  body: any,
  requestId: string | null,
  key: string,
): AIDiagnostic {
  if (requestId) requestId = redact(requestId, key);
  const error = body?.error,
    providerCode = redact(
      error?.code ?? error?.type ?? body?.base_resp?.status_code ?? "",
      key,
    );
  const message = redact(
    error?.message ??
      (typeof error === "string" ? error : undefined) ??
      body?.base_resp?.status_msg ??
      `供应商返回 HTTP ${status}，未提供结构化错误说明。`,
    key,
  );
  const suggestion =
    status === 401
      ? "API Key 验证失败，请检查密钥与区域。"
      : status === 402
        ? "账户余额或套餐不足，请在供应商控制台检查。"
        : status === 403
          ? "访问被拒绝，请检查模型权限、区域与套餐限制。"
          : status === 404
            ? "未找到模型或接口，请检查 Model name 和 Base URL。"
            : status === 429
              ? "供应商限流或额度不足，请稍后重试并检查配额。"
              : status === 400
                ? "请求参数不被接受，请根据供应商错误说明检查模型和参数。"
                : "检查供应商服务状态；保留请求编号供排查。";
  return {
    code: `provider-http-${status}`,
    stage: "response",
    httpStatus: status,
    message,
    suggestion,
    ...(providerCode ? { providerCode } : {}),
    ...(requestId && /^[\w:.-]{1,150}$/.test(requestId) ? { requestId } : {}),
  };
}

import { z } from "zod";
export const providerSchema = z.enum([
  "deepseek",
  "gemini",
  "minimax",
  "mimo",
  "grok",
  "qwen",
  "openai_compatible",
]);
export const providers = {
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    secret: "POWERMATCH_AI_DEEPSEEK_KEY",
  },
  gemini: {
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    secret: "POWERMATCH_AI_GEMINI_KEY",
  },
  minimax: {
    name: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    secret: "POWERMATCH_AI_MINIMAX_KEY",
  },
  mimo: {
    name: "MiMo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    secret: "POWERMATCH_AI_MIMO_KEY",
  },
  grok: {
    name: "Grok",
    baseUrl: "https://api.x.ai/v1",
    secret: "POWERMATCH_AI_GROK_KEY",
  },
  qwen: {
    name: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    secret: "POWERMATCH_AI_QWEN_KEY",
  },
  openai_compatible: {
    name: "OpenAI 兼容",
    baseUrl: "https://openrouter.ai/api/v1",
    secret: null,
  },
} as const;
export type Provider = keyof typeof providers;
export function validBaseURL(provider: Provider, base: string) {
  try {
    const url = new URL(base);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    )
      return false;
    const path = url.pathname.replace(/\/$/, "");
    const families: Record<string, boolean> = {
      deepseek:
        url.hostname === "api.deepseek.com" && ["", "/v1"].includes(path),
      gemini:
        url.hostname === "generativelanguage.googleapis.com" &&
        ["/v1beta", "/v1beta/openai"].includes(path),
      minimax: url.hostname === "api.minimaxi.com" && path === "/v1",
      mimo: url.hostname === "api.xiaomimimo.com" && path === "/v1",
      grok: url.hostname === "api.x.ai" && path === "/v1",
      qwen:
        ([
          "dashscope.aliyuncs.com",
          "dashscope-intl.aliyuncs.com",
          "dashscope-us.aliyuncs.com",
          "cn-hongkong.dashscope.aliyuncs.com",
        ].includes(url.hostname) ||
          /^[a-z0-9-]+\.(cn-beijing|ap-southeast-1|ap-northeast-1|cn-hongkong)\.maas\.aliyuncs\.com$/.test(
            url.hostname,
          )) &&
        path === "/compatible-mode/v1",
    };
    return provider === "openai_compatible"
      ? Object.values(families).some(Boolean) ||
          (url.hostname === "openrouter.ai" && path === "/api/v1") ||
          (url.hostname === "api.openai.com" && path === "/v1")
      : families[provider];
  } catch {
    return false;
  }
}
const price = z.number().finite().min(0).max(10000).nullable();
export const modelConfigSchema = z
  .object({
    provider: providerSchema,
    name: z.string().trim().min(1).max(80),
    model: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[\w.\-:/]+$/),
    baseUrl: z.string().trim().max(1000).default(""),
    inputPrice: price,
    outputPrice: price,
    currency: z.enum(["CNY", "USD"]),
    requestPrice: price.default(null),
    billingMode: z
      .enum(["tokens", "request", "tokens_request", "plan"])
      .default("tokens"),
    priceSource: z
      .string()
      .trim()
      .max(2000)
      .refine((s) => !s || /^https:\/\//i.test(s), "https-source-required")
      .default(""),
    priceNote: z.string().max(1000).default(""),
  })
  .strict()
  .transform((c) => ({
    ...c,
    baseUrl: (c.baseUrl || providers[c.provider].baseUrl).replace(/\/+$/, ""),
  }))
  .refine(
    (c) => validBaseURL(c.provider, c.baseUrl),
    "invalid-provider-base-url",
  );
export type AIConfig = z.infer<typeof modelConfigSchema>;
export interface AIModel extends AIConfig {
  diagnostic?: import("./ai-diagnostic").AIDiagnostic | null;
  id: string;
  enabled: boolean;
  isDefault: boolean;
  health: string;
  checkedAt: string | null;
  revision: number;
  keyConfigured: boolean;
  keySource?: string;
  latencyMs?: number | null;
  apiKey?: string;
}
export function runtimeIdentity(c: AIConfig) {
  return JSON.stringify([c.provider, c.baseUrl, c.model]);
}
export function secretTarget(c: AIConfig) {
  return `${c.provider}|${c.baseUrl}`;
}
export function estimateCost(
  c: AIConfig,
  input: number | null,
  output: number | null,
): number | null {
  if (c.billingMode === "plan") return null;
  if (c.billingMode === "request") return c.requestPrice;
  if (
    input === null ||
    output === null ||
    c.inputPrice === null ||
    c.outputPrice === null
  )
    return null;
  const tokens = (input * c.inputPrice + output * c.outputPrice) / 1e6;
  return c.billingMode === "tokens_request"
    ? c.requestPrice === null
      ? null
      : tokens + c.requestPrice
    : tokens;
}
export function costCny(
  cost: number | null,
  currency: string,
  usdToCny: number | null,
) {
  return cost === null
    ? null
    : currency === "CNY"
      ? cost
      : usdToCny === null
        ? null
        : cost * usdToCny;
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function beijingTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(
    /[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(" ", "T") + "Z",
  );
  return Number.isNaN(date.getTime())
    ? "—"
    : new Date(date.getTime() + 8 * 3600000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
}

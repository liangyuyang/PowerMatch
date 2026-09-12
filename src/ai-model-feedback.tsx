import { useEffect, useState, useRef } from "react";
import type { AIModel } from "./shared/ai-config";
import type { AIDiagnostic } from "./shared/ai-diagnostic";
import type { PriceOption } from "../worker/ai-pricing";
import { beijingTime } from "./shared/ai-config";
const priceErrors: Record<string, string> = {
  "price-source-unsupported":
    "此链接暂不支持自动读取。目前支持 DeepSeek 官方中英文价格页；其他来源请手动填写，系统不会猜测价格。",
  "price-model-not-found":
    "价格页里未找到完全匹配的模型。请核对 Model name；未修改任何价格。",
  "price-fetch-failed":
    "价格页读取失败或超过 15 秒，请稍后重试。未修改任何价格。",
  "price-currency-unknown": "无法确认价格币种，未填写。",
  "price-currency-ambiguous": "价格包含多个币种，无法确定适用值，未填写。",
  "price-tier-ambiguous": "页面包含未能区分的价格档位，未填写。",
  "price-incomplete": "未同时找到完整的输入与输出价格，未填写。",
  "price-format-unsupported": "价格页面格式尚不支持解析，未填写。",
  "price-not-found": "未识别到价格，未填写。",
};
export function AIDiagnosticView({ diagnostic }: { diagnostic: AIDiagnostic }) {
  const [copied, setCopied] = useState("");
  return (
    <div className="ms-diagnostic" role="status">
      <strong>
        检查失败 · {diagnostic.code}
        {diagnostic.httpStatus !== undefined
          ? ` · HTTP ${diagnostic.httpStatus}`
          : ""}
      </strong>
      <p>{diagnostic.message}</p>
      <p>建议：{diagnostic.suggestion}</p>
      <details>
        <summary>查看诊断代码与请求信息</summary>
        <pre>{JSON.stringify(diagnostic, null, 2)}</pre>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard
              .writeText(JSON.stringify(diagnostic, null, 2))
              .then(() => setCopied("已复制诊断信息"))
              .catch(() => setCopied("复制失败，请选择上方文字复制"))
          }
        >
          复制诊断信息
        </button>
        <span>{copied}</span>
      </details>
    </div>
  );
}
export function AIModelFeedback({
  model,
  onPatch,
  disabled,
}: {
  model: AIModel;
  onPatch: (patch: Partial<AIModel>) => void;
  disabled: boolean;
}) {
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<{
      source: string;
      checkedAt: string;
      options: PriceOption[];
    } | null>(null),
    [notice, setNotice] = useState("");
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    setResult(null);
    setError("");
    setNotice("");
  }, [model.provider, model.model, model.priceSource]);
  async function read() {
    const version = epoch.current;
    setLoading(true);
    setError("");
    setNotice("");
    setResult(null);
    try {
      const r = await fetch("/api/admin/ai/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: model.provider,
          model: model.model,
          source: model.priceSource,
        }),
      });
      const data: any = await r.json();
      if (version !== epoch.current) return;
      if (!r.ok) throw Error(data.error ?? `HTTP ${r.status}`);
      setResult(data);
    } catch (e) {
      if (version !== epoch.current) return;
      setError(e instanceof Error ? e.message : "price-fetch-failed");
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      {model.health !== "ok" && model.health !== "unchecked" && (
        <AIDiagnosticView
          diagnostic={
            model.diagnostic ?? {
              code: model.health,
              stage: "历史记录",
              message: "旧记录只保存了错误码，没有 HTTP 状态或供应商详情。",
              suggestion:
                "点击“检查此模型”重新检查，新记录会显示失败阶段和诊断信息。",
            }
          }
        />
      )}
      <div className="ms-price-reader">
        <div className="ms-actions">
          <button
            type="button"
            disabled={disabled || loading || !model.priceSource}
            onClick={() => void read()}
          >
            {loading ? "读取价格中…" : "从链接读取价格"}
          </button>
          <small>
            连接检查不读取价格。先填写价格来源，再读取并选择适用档位。
          </small>
        </div>
        {error && (
          <p role="alert">
            {priceErrors[error] ?? "读取未成功，价格保持原值。"}{" "}
            <code>{error}</code>
          </p>
        )}
        {result && (
          <div>
            <p>
              读取于 {beijingTime(result.checkedAt)}（北京时间） ·{" "}
              <a href={result.source} target="_blank" rel="noreferrer">
                官方来源 ↗
              </a>
            </p>
            <p>
              识别到以下档位。填入后仍需点击“保存模型设置”。当前费用估算不自动切换时段或缓存折扣。
            </p>
            <div className="ms-price-options">
              {result.options.map((option) => (
                <article key={option.label}>
                  <strong>
                    {option.label} · {option.currency}/百万 Token
                  </strong>
                  <p>
                    输入（缓存未命中）：{option.inputPrice} · 输出：
                    {option.outputPrice}
                  </p>
                  <p>缓存命中输入：{option.cacheHitPrice ?? "未提供"}</p>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onPatch({
                        inputPrice: option.inputPrice,
                        outputPrice: option.outputPrice,
                        currency: option.currency,
                        billingMode: "tokens",
                        requestPrice: null,
                        priceNote:
                          option.priceNote +
                          ` 读取时间：${beijingTime(result.checkedAt)}。`,
                      });
                      setNotice(`已将“${option.label}”填入草稿，请保存。`);
                    }}
                  >
                    填入{option.label}
                  </button>
                </article>
              ))}
            </div>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
    </>
  );
}

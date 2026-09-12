import React, { useEffect, useRef, useState } from "react";
import type { Design, Locale, Viewer } from "./shared/model";
import { lockGroups, type LockGroup } from "./shared/assistant";
import { explain } from "./i18n";

async function request(path: string, data?: unknown) {
  const r = await fetch("/api" + path, {
    method: data ? "POST" : "GET",
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const x: any = await r.json();
  if (!r.ok) throw new Error(x.error || `HTTP ${r.status}`);
  return x;
}
const providerNames: Record<string, string> = {
  deepseek: "DeepSeek",
  gemini: "Gemini",
  minimax: "MiniMax",
  mimo: "MiMo",
  grok: "Grok",
  qwen: "Qwen",
  openai_compatible: "OpenAI 兼容",
};
function parameterLabel(path: string, zh: boolean) {
  const names: Record<string, string> = {
    mode: "供电方式",
    path: "稳压方式",
    horizonDays: "演算天数",
    margin: "设计余量 (%)",
    source: "光源",
    lux: "照度 (lux)",
    days: "每周照明天数",
    hours: "每天照明时长 (h)",
    startHour: "开灯时间 (h)",
    angle: "照射角度 (°)",
    componentId: "元器件型号",
    areaCm2: "光伏面积 (cm²)",
    referenceLux: "参考照度 (lux)",
    densityUwCm2: "功率密度 (µW/cm²)",
    voltage: "电压 (V)",
    utilization: "光伏利用率",
    kind: "储能类型",
    series: "串联数量",
    parallel: "并联数量",
    capacityMah: "电池容量 (mAh)",
    farads: "电容量 (F)",
    maxVoltage: "最高电压 (V)",
    minVoltage: "截止电压 (V)",
    initialPercent: "初始储能 (%)",
    leakUa: "漏电流 (µA)",
    esr: "等效串联电阻 (Ω)",
    iqUa: "静态电流 (µA)",
    dropout: "压差 (V)",
    efficiency: "稳压效率",
    harvestEfficiency: "采集效率",
    mppt: "MPPT",
    charger: "充电管理",
  };
  const key = path.split(".").at(-1)!;
  return zh
    ? (names[key] ?? key)
    : path.replaceAll(".", " · ").replace(/([a-z])([A-Z])/g, "$1 $2");
}
function parameterValue(value: unknown, zh: boolean) {
  if (value === null) return zh ? "待补全" : "Unknown";
  const values: Record<string, string> = {
    pv: "纯光伏",
    battery: "电池",
    hybrid: "光伏 + 储能",
    primary: "不可充电电池",
    rechargeable: "可充电电池",
    lic: "锂超容",
    supercap: "超级电容",
    direct: "直接供电",
    ldo: "LDO",
    converter: "转换器",
    office: "办公室",
    home: "家庭",
  };
  if (typeof value === "boolean")
    return value ? (zh ? "是" : "Yes") : zh ? "否" : "No";
  return zh && typeof value === "string"
    ? (values[value] ?? value)
    : String(value);
}
const errors: Record<string, string> = {
  "missing-key": "请先配置该提供商的密钥。",
  "health-check-required": "先保存配置，完成健康检查，再启用模型。",
  "ai-rate-limited": "调用过于频繁或已达到今日额度，请稍后再试。",
  "locked-parameters":
    "建议涉及锁定参数，未应用任何修改。请让助手保留这些参数后重试。",
  "model-unavailable": "该模型暂不可用，请刷新模型列表。",
  "provider-invalid-json": "模型未返回有效的调整建议，设计保持不变。",
  "invalid-ai-proposal": "模型返回的参数不符合设计规则，未应用修改。",
  "config-conflict": "配置已被更新，请刷新后重试。",
};
const errorText = (e: unknown, zh: boolean) => {
  const s = e instanceof Error ? e.message : String(e);
  return zh ? (errors[s] ?? s) : s;
};

export { AIAdmin } from "./model-settings";

type DialogProps = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  variant?: "drawer";
};
export function AIAssistant({
  open,
  onClose,
  Dialog,
  design,
  locale,
  viewer,
  onApply,
  onCompare,
  onLogin,
}: {
  open: boolean;
  onClose: () => void;
  Dialog: React.ComponentType<DialogProps>;
  design: Design;
  locale: Locale;
  viewer: Viewer | null;
  onApply: (base: Design, next: Design) => void;
  onCompare: (next: Design) => void;
  onLogin: () => void;
}) {
  const identityEpoch = useRef(0);
  const explicitModel = useRef(false);
  const zh = locale === "zh",
    bi = (a: string, b: string) => (zh ? a : b);
  const [models, setModels] = useState<any[]>([]),
    [model, setModel] = useState(""),
    [message, setMessage] = useState(""),
    [history, setHistory] = useState<
      { role: "user" | "assistant"; content: string }[]
    >([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reply, setReply] = useState<any>(null),
    [base, setBase] = useState<Design | null>(null),
    [locks, setLocks] = useState<LockGroup[]>(["load"]);
  const refresh = () =>
    request("/ai/models")
      .then((x) => {
        setModels(x.models);
        setModel((previous) =>
          explicitModel.current && x.models.some((m: any) => m.id === previous)
            ? previous
            : (x.models.find((m: any) => m.isDefault)?.id ??
              x.models[0]?.id ??
              ""),
        );
      })
      .catch((e) => setError(errorText(e, zh)));
  useEffect(() => {
    if (open) void refresh();
  }, [open]);
  useEffect(() => {
    identityEpoch.current++;
    explicitModel.current = false;
    setHistory([]);
    setReply(null);
    setBase(null);
    setMessage("");
  }, [viewer?.id]);
  const stale = !!base && JSON.stringify(base) !== JSON.stringify(design);
  const labels: Record<LockGroup, string> = {
    load: bi("设备耗电", "Device load"),
    light: bi("光照", "Lighting"),
    pv: bi("光伏", "PV"),
    storage: bi("储能", "Storage"),
    regulation: bi("电源管理", "Regulation"),
    mode: bi("供电方式", "Supply mode"),
    path: bi("稳压方式", "Power path"),
  };
  const send = async () => {
    const snapshot = structuredClone(design),
      text = message.trim(),
      epoch = identityEpoch.current;
    if (!text || busy) return;
    setBusy(true);
    setError("");
    setReply(null);
    setBase(snapshot);
    try {
      const x = await request("/ai/assist", {
        design: snapshot,
        modelId: model,
        locale,
        message: text,
        locks,
        history: history.slice(-8),
      });
      if (epoch !== identityEpoch.current) return;
      setReply(x);
      setHistory((h) => [
        ...h.slice(-6),
        { role: "user", content: text },
        { role: "assistant", content: x.proposal.explanation },
      ]);
      setMessage("");
    } catch (e) {
      setError(errorText(e, zh));
    } finally {
      setBusy(false);
    }
  };
  if (!open) return null;
  return (
    <Dialog
      title={bi("AI 设计助手", "AI design assistant")}
      onClose={onClose}
      variant="drawer"
    >
      <div className="ai-assistant">
        <p>
          {bi(
            "说出目标，让助手选型并提出调整。续航由计算引擎计算；建议不会自动保存或公开。",
            "Describe your goal. The assistant selects parts and proposes changes; the engine calculates runtime. Suggestions are not automatically saved or published.",
          )}
        </p>
        <p className="muted">
          {bi(
            "发送时，当前设计和本次对话会交给你选择的 AI 提供商。",
            "Sending shares the current design and this conversation with your selected AI provider.",
          )}
        </p>
        <div className="ai-actions">
          <select
            aria-label={bi("选择 AI", "Choose AI")}
            value={model}
            onChange={(e) => {
              explicitModel.current = true;
              setModel(e.target.value);
            }}
            disabled={busy}
          >
            {models.length ? (
              models.map((m) => (
                <option key={m.id} value={m.id}>
                  {providerNames[m.provider]} · {m.name}
                  {m.isDefault ? " ★" : ""}
                </option>
              ))
            ) : (
              <option value="">
                {bi("暂无已启用模型", "No enabled models")}
              </option>
            )}
          </select>
          <button disabled={busy} onClick={() => void refresh()}>
            {bi("刷新", "Refresh")}
          </button>
        </div>
        {!viewer && (
          <button onClick={onLogin}>
            {bi("登录后使用 AI 助手", "Sign in to use AI")}
          </button>
        )}
        {!models.length && (
          <p>
            {bi(
              "管理员配置密钥、完成健康检查并启用后，模型会出现在这里。",
              "Models appear here after the admin configures keys, checks health and enables them.",
            )}
          </p>
        )}
        <details open>
          <summary>
            {bi("哪些参数不让 AI 改", "Parameters AI must keep")}
          </summary>
          <p>{bi("勾选后，AI 必须保留这组参数；未勾选的可以提出调整建议。锁定不会阻止你手动修改。", "Checked groups must stay unchanged in AI proposals. You can still edit them manually.")}</p>
          <div className="ai-locks">
            {lockGroups.map((g) => (
              <label key={g}>
                <input
                  type="checkbox"
                  checked={locks.includes(g)}
                  disabled={busy}
                  onChange={(e) => {
                    setLocks((l) =>
                      e.target.checked ? [...l, g] : l.filter((x) => x !== g),
                    );
                    setReply(null);
                  }}
                />
                {labels[g]}
              </label>
            ))}
          </div>
        </details>
        <div className="ai-conversation">
          {history.map((h, i) => (
            <div key={i} className={`ai-message ${h.role}`}>
              <small>{h.role === "user" ? bi("你", "You") : "AI"}</small>
              <p>{h.content}</p>
            </div>
          ))}
        </div>
        <div className="ai-prompts">
          {[
            bi(
              "周末不开灯也要继续测量，帮我调整。",
              "Keep measuring through an unlit weekend.",
            ),
            bi(
              "保留设备耗电，选一套电池供电方案。",
              "Keep device load and select a battery supply.",
            ),
            bi("为什么现在不能算出续航？", "Why is runtime unavailable?"),
          ].map((s) => (
            <button key={s} disabled={busy} onClick={() => setMessage(s)}>
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            aria-label={bi("设计需求", "Design request")}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={3000}
            placeholder={bi(
              "例如：保持测量频率不变，把无光续航延长…",
              "For example: keep the measurement rate and extend dark runtime…",
            )}
          />
          <button
            className="primary"
            disabled={!viewer || !model || busy || !message.trim()}
          >
            {busy
              ? bi("正在分析与演算…", "Analyzing & calculating…")
              : bi("发送", "Send")}
          </button>
        </form>
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
        {reply && (
          <div className="ai-proposal">
            <h3>{bi("调整预览", "Change preview")}</h3>
            <div className="ai-diff">
              {reply.changes.map((c: any) => (
                <div key={c.path}>
                  <span>{parameterLabel(c.path, zh)}</span>
                  <span>
                    {parameterValue(c.before, zh)} →{" "}
                    <b>{parameterValue(c.after, zh)}</b>
                  </span>
                </div>
              ))}
            </div>
            <div className="ai-metrics">
              {["before", "result"].map((key, i) => (
                <div key={key}>
                  <small>
                    {i ? bi("建议方案", "Proposed") : bi("当前方案", "Current")}
                  </small>
                  <b>
                    {reply[key].status === "conditional"
                      ? reply[key].runtimeHours === null
                        ? `≥ ${i ? reply.design.horizonDays * 24 : base!.horizonDays * 24} h`
                        : `${reply[key].runtimeHours.toFixed(1)} h`
                      : bi("尚不能确定", "Undetermined")}
                  </b>
                  <span>
                    {bi("无光续航", "Dark runtime")}:{" "}
                    {reply[key].status === "conditional" &&
                    reply[key].darkHours !== null
                      ? `${reply[key].darkHours.toFixed(1)} h`
                      : "—"}
                  </span>
                </div>
              ))}
            </div>
            <p>
              {bi(
                "结果为条件估算，完整电气验证仍需实测。",
                "Results are conditional estimates; full electrical validation still needs measurements.",
              )}
            </p>
            {[
              ...reply.result.missing,
              ...reply.result.errors,
              ...reply.result.warnings,
            ].map((s: string, i: number) => (
              <p className="ai-warning" key={i}>
                {explain(locale, s)}
              </p>
            ))}
            {reply.proposal.assumptions.map((a: string, i: number) => (
              <p key={i}>{a}</p>
            ))}
            {reply.sources.map((c: any) => (
              <p key={c.id}>
                <a
                  href={
                    /^https:\/\//.test(c.source) ||
                    c.source.startsWith("/assets/")
                      ? c.source
                      : undefined
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {c.manufacturer} · {c.name} ↗
                </a>{" "}
                ·{" "}
                {c.verified
                  ? bi("库内资料", "Catalog data")
                  : bi("资料待补全", "Incomplete data")}
              </p>
            ))}
            {stale && (
              <p role="status">
                {bi(
                  "当前设计已改变，请重新提问以生成最新建议。",
                  "The design has changed. Ask again for an up-to-date proposal.",
                )}
              </p>
            )}
            <div className="ai-actions">
              <button
                className="primary"
                disabled={stale || !reply.changes.length}
                onClick={() => {
                  onApply(base!, reply.design);
                  setReply(null);
                  onClose();
                }}
              >
                {bi("应用到草稿", "Apply to draft")}
              </button>
              <button
                disabled={stale || !reply.changes.length}
                onClick={() => {
                  onCompare(reply.design);
                  onClose();
                }}
              >
                {bi("复制为对比方案", "Copy to comparison")}
              </button>
            </div>
            <small>
              {reply.model} · {reply.usage.input ?? "—"} /{" "}
              {reply.usage.output ?? "—"} tokens ·{" "}
              {reply.usage.cost === null
                ? bi("费用待定", "Cost unknown")
                : `${reply.usage.cost.toFixed(5)} ${reply.usage.currency}`}
            </small>
          </div>
        )}
      </div>
    </Dialog>
  );
}

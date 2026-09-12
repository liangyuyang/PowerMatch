import { useEffect, useMemo, useState } from "react";
import {
  providers,
  modelConfigSchema,
  beijingTime,
  csvCell,
  type AIModel,
  type Provider,
} from "./shared/ai-config";
import type { Locale } from "./shared/model";
import "./model-settings.css";
import { AIModelFeedback, AIDiagnosticView } from "./ai-model-feedback";

async function api(path: string, data?: unknown) {
  const r = await fetch("/api/admin/ai" + path, {
    method: data ? "POST" : "GET",
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const x: any = await r.json();
  if (!r.ok) throw Error(x.error ?? `HTTP ${r.status}`);
  return x;
}
const message = (e: unknown) => {
  const s = e instanceof Error ? e.message : String(e);
  return (
    (
      {
        "config-conflict":
          "配置已在其他窗口更新。当前输入已保留，请重新读取配置后再保存。",
        "health-check-required": "先保存设置并完成健康检查，才能设为默认模型。",
        "missing-key": "尚未配置 API Key。",
        "ai-rate-limited": "已达到调用频率或额度限制，请稍后重试。",
        "key-storage-not-configured":
          "密钥至少需要 10 个字符，且服务端加密存储必须可用。",
        "provider-http-401": "密钥验证失败，请检查 Key、区域和套餐。",
        "provider-http-403": "提供商拒绝访问，请检查模型权限与账户状态。",
        "provider-http-404":
          "提供商未找到此模型或接口，请检查 Model name 和 Base URL。",
        "provider-invalid-json": "已收到回复，但未通过 JSON 格式检查。",
        "provider-invalid-response": "未取得完整回复，请检查该模型的兼容性。",
        "invalid-input": "设置格式不正确，请检查输入。",
        "model-list-incomplete": "模型列表已改变，请重新读取配置。",
      } as Record<string, string>
    )[s] ?? s
  );
};
function health(s: string) {
  return s === "ok"
    ? "可用"
    : s === "unchecked"
      ? "未检查"
      : s === "missing-key"
        ? "未配置 Key"
        : "失败";
}
function tokens(n: number) {
  return n >= 1e6
    ? `${(n / 1e6).toFixed(2)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(2)}K`
      : String(n);
}
function rmb(n: number) {
  return `¥${n.toFixed(4)}`;
}
type Usage = {
  period: string;
  label: string;
  model_id: string;
  model_name: string;
  provider: string;
  user_id: string;
  caller: string;
  email: string;
  purpose: string;
  currency: string;
  calls: number;
  successes: number;
  failures: number;
  pending: number;
  input_tokens: number;
  output_tokens: number;
  unknown_usage: number;
  native_cost: number;
  unknown_native: number;
  cost_cny: number;
  unknown_cost: number;
  latest: string;
};
function summary(rows: Usage[]) {
  return rows.reduce(
    (a, r) => ({
      calls: a.calls + r.calls,
      failures: a.failures + r.failures,
      pending: a.pending + r.pending,
      tokens: a.tokens + r.input_tokens + r.output_tokens,
      unknownUsage: a.unknownUsage + r.unknown_usage,
      cost: a.cost + r.cost_cny,
      unknown: a.unknown + r.unknown_cost,
    }),
    {
      calls: 0,
      failures: 0,
      pending: 0,
      tokens: 0,
      unknownUsage: 0,
      cost: 0,
      unknown: 0,
    },
  );
}
function money(cost: number, unknown: number) {
  return unknown
    ? `${cost > 0 ? `${rmb(cost)} 已知部分 · ` : ""}${unknown} 次待确认`
    : rmb(cost);
}
const configFields = [
  "provider",
  "name",
  "model",
  "baseUrl",
  "inputPrice",
  "outputPrice",
  "requestPrice",
  "currency",
  "billingMode",
  "priceSource",
  "priceNote",
] as const;
function configOf(m: AIModel) {
  return Object.fromEntries(configFields.map((k) => [k, m[k]]));
}
function editable(m: AIModel) {
  return {
    id: m.id,
    config: configOf(m),
    enabled: m.enabled,
    isDefault: m.isDefault,
    apiKey: m.apiKey ?? "",
  };
}
const purpose = (s: string) =>
  (
    ({ health: "健康检查", design: "设计助手", mail: "邮件投递" }) as Record<
      string,
      string
    >
  )[s] ?? s;
const statusLabel = (s: string) =>
  (
    ({
      ok: "成功",
      pending: "等待 / 运行中",
      failed: "失败",
      accepted: "已接收",
      sending: "发送中",
    }) as Record<string, string>
  )[s] ?? s;

export function AIAdmin({ locale }: { locale: Locale }) {
  const [settings, setSettings] = useState<any>(null),
    [models, setModels] = useState<AIModel[]>([]),
    [billing, setBilling] = useState<{ usdToCny: number | null }>({
      usdToCny: null,
    });
  const [rows, setRows] = useState<Usage[]>([]),
    [status, setStatus] = useState(""),
    [loadError, setLoadError] = useState(""),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [apiOpen, setApiOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<any>(null),
    [opsBusy, setOpsBusy] = useState(false),
    [taskStatus, setTaskStatus] = useState(""),
    [taskType, setTaskType] = useState("");
  const [reloadPrompt, setReloadPrompt] = useState(false);
  const [provider, setProvider] = useState<Provider>("deepseek");
  const dirty =
    !!settings &&
    (JSON.stringify(models.map(editable)) !==
      JSON.stringify(settings.models.map(editable)) ||
      JSON.stringify(billing) !== JSON.stringify(settings.billing));
  const usable = models.filter(
    (m) => m.enabled && m.keyConfigured && m.health === "ok",
  );
  const currentDefault = settings?.models.find((m: AIModel) => m.isDefault);
  async function refreshUsage() {
    setRefreshing(true);
    try {
      setRows((await api("/usage")).rows);
    } catch (e) {
      setStatus(message(e));
    } finally {
      setRefreshing(false);
    }
  }
  async function load() {
    setLoadError("");
    try {
      const x = await api("");
      setSettings(x);
      setModels(x.models.map((m: AIModel) => ({ ...m, apiKey: "" })));
      setBilling(x.billing);
      if (!x.models.length) setApiOpen(true);
      await refreshUsage();
    } catch (e) {
      setLoadError(message(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function update(id: string, patch: Partial<AIModel>) {
    setModels((current) =>
      current.map((m) =>
        m.id === id
          ? {
              ...m,
              ...patch,
              ...(patch.enabled === false ? { isDefault: false } : {}),
            }
          : m,
      ),
    );
  }
  function add() {
    const sample: Partial<Record<Provider, string>> = {
      deepseek: "deepseek-v4-pro",
      gemini: "gemini-3.5-flash",
      minimax: "MiniMax-M3",
      mimo: "mimo-v2.5-pro",
      qwen: "qwen-plus",
    };
    setModels((m) => [
      ...m,
      {
        id: `${provider}-${crypto.randomUUID().slice(0, 8)}`,
        provider,
        name: providers[provider].name,
        model: sample[provider] ?? "",
        baseUrl: providers[provider].baseUrl,
        inputPrice: null,
        outputPrice: null,
        requestPrice: null,
        currency: "CNY",
        billingMode: "tokens",
        priceSource: "",
        priceNote: "",
        enabled: true,
        isDefault: false,
        health: "unchecked",
        checkedAt: null,
        revision: 0,
        keyConfigured: !!settings.providerKeys?.[provider],
        apiKey: "",
      },
    ]);
    setApiOpen(true);
  }
  async function save() {
    const payload = models.map((m) => {
      const parsed = modelConfigSchema.safeParse(configOf(m));
      if (!parsed.success)
        throw Error(
          `${m.name || "模型"}：请填写 Model name，并检查 Base URL 与单价。`,
        );
      return {
        id: m.id,
        config: parsed.data,
        enabled: m.enabled,
        isDefault: m.isDefault,
        revision: m.revision,
        apiKey: m.apiKey ?? "",
      };
    });
    await api("/settings", {
      revision: settings.revision,
      billing,
      models: payload,
    });
    const x = await api("");
    setSettings(x);
    setModels(x.models.map((m: AIModel) => ({ ...m, apiKey: "" })));
    setBilling(x.billing);
    setStatus("模型设置已保存。API Key 不回显；留空保留已有 Key。");
    return x;
  }
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setStatus("");
    try {
      await fn();
    } catch (e) {
      setStatus(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function chooseDefault(m: AIModel) {
    await api("/default", { id: m.id, revision: settings.revision });
    await load();
    setStatus(`默认模型已切换为 ${m.name}。`);
  }
  async function check(id?: string) {
    const x = dirty ? await save() : settings;
    const targets = x.models.filter((m: AIModel) =>
      id ? m.id === id : m.enabled,
    );
    let ok = 0;
    const failed: string[] = [];
    for (const [i, m] of targets.entries()) {
      setStatus(`正在检查 ${m.name}（${i + 1}/${targets.length}）…`);
      try {
        await api(`/${m.id}/check`, {});
        ok++;
      } catch (e) {
        failed.push(`${m.name}：${message(e)}`);
      }
    }
    await load();
    setStatus(
      targets.length
        ? `检查完成：${ok}/${targets.length} 可用。${failed.join("；")}`
        : "没有需要检查的已启用模型。",
    );
  }
  const cards = useMemo(
    () =>
      [
        { key: "day", label: "今日" },
        { key: "week", label: "本周" },
        { key: "total", label: "近 90 天" },
      ].map((p) => ({
        ...p,
        rows: rows.filter((r) => r.period === p.key),
        summary: summary(rows.filter((r) => r.period === p.key)),
      })),
    [rows],
  );
  const bars = useMemo(() => {
    const grouped = new Map<string, Usage[]>();
    for (const r of rows.filter((r) => r.period === "total"))
      grouped.set(r.model_id, [...(grouped.get(r.model_id) ?? []), r]);
    return [...grouped]
      .map(([id, list]) => ({
        id,
        name:
          settings?.models.find((m: AIModel) => m.id === id)?.name ??
          list[0].model_name,
        ...summary(list),
      }))
      .sort((a, b) => b.cost - a.cost);
  }, [rows, settings]);
  const totalCost = bars.reduce((a, b) => a + b.cost, 0);
  function exportCSV() {
    const fields = [
      "period",
      "label",
      "model_name",
      "caller",
      "email",
      "purpose",
      "calls",
      "successes",
      "failures",
      "pending",
      "input_tokens",
      "output_tokens",
      "unknown_usage",
      "native_cost",
      "currency",
      "unknown_native",
      "cost_cny",
      "unknown_cost",
      "latest",
    ];
    const text =
      "\uFEFF" +
      [
        fields.map(csvCell).join(","),
        ...rows.map((r) => fields.map((k) => csvCell((r as any)[k])).join(",")),
      ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `powermatch-ai-usage-${beijingTime(new Date().toISOString()).slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function table(title: string, list: Usage[]) {
    return (
      <section className="ms-usage-table">
        <h3>{title}</h3>
        <div className="ms-table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "期间",
                  "模型",
                  "调用人",
                  "用途",
                  "次数",
                  "成功 / 失败 / 进行中",
                  "用量",
                  "费用（人民币）",
                  "最后调用（北京时间）",
                ].map((s) => (
                  <th key={s}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={i}>
                  <td>{r.period === "total" ? "近 90 天" : r.label}</td>
                  <td>{r.model_name}</td>
                  <td title={r.email}>{r.caller}</td>
                  <td>{purpose(r.purpose)}</td>
                  <td>{r.calls}</td>
                  <td>
                    {r.successes} / {r.failures} / {r.pending}
                  </td>
                  <td>
                    {tokens(r.input_tokens + r.output_tokens)} tokens
                    {r.unknown_usage > 0 && (
                      <small>{r.unknown_usage} 次用量待确认</small>
                    )}
                  </td>
                  <td>
                    {money(r.cost_cny, r.unknown_cost)}
                    <small>
                      {r.unknown_native === r.calls
                        ? "原币种费用待确认"
                        : `${r.currency} ${r.native_cost.toFixed(4)}${r.unknown_native ? "（已知部分）" : ""}`}
                    </small>
                  </td>
                  <td>{beijingTime(r.latest)}</td>
                </tr>
              ))}
              {!list.length && (
                <tr>
                  <td colSpan={9}>还没有 AI 调用记录。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    );
  }
  async function ops() {
    setOpsBusy(true);
    try {
      setDiagnostics(await api("/diagnostics"));
    } catch (e) {
      setStatus(message(e));
    } finally {
      setOpsBusy(false);
    }
  }
  const tasks =
    diagnostics?.recent.filter(
      (r: any) =>
        (!taskStatus || r.status === taskStatus) &&
        (!taskType || r.type === taskType),
    ) ?? [];
  if (loadError && !settings)
    return (
      <section className="panel model-settings-panel">
        <p role="alert">模型配置读取失败：{loadError}</p>
        <button onClick={() => void load()}>重试</button>
      </section>
    );
  if (!settings)
    return (
      <section className="panel model-settings-panel">
        正在读取真实模型配置与费用统计…
      </section>
    );
  return (
    <section className="panel model-settings-panel" lang="zh-CN">
      <div className="ms-heading">
        <div>
          <h2>AI 模型设置与计费</h2>
          <p>先看默认模型和用量；API、价格、Key 等细节放在下方参考区。</p>
        </div>
        <button
          disabled={busy}
          onClick={() => (dirty ? setReloadPrompt(true) : void load())}
        >
          重新读取
        </button>
      </div>
      {reloadPrompt && (
        <div className="ms-draft" role="alert">
          重新读取会放弃未保存的设置。
          <button onClick={() => setReloadPrompt(false)}>保留当前输入</button>
          <button
            onClick={() => {
              setReloadPrompt(false);
              void load();
            }}
          >
            放弃修改并重新读取
          </button>
        </div>
      )}
      {dirty && (
        <p className="ms-draft">
          有未保存的设置。保存后可选择默认模型；刷新统计不会覆盖输入。
        </p>
      )}
      <div className="ms-overview">
        <div className="ms-default-card">
          <span>当前默认模型</span>
          <strong>{currentDefault?.name ?? "尚未设置"}</strong>
          <small>
            {currentDefault?.model ?? "保存模型并完成健康检查后选择默认项"}
          </small>
          <small>
            {usable.length}/{models.length} 个模型已启用且通过检查
          </small>
        </div>
        <div className="ms-choice-list">
          {models.map((m) => (
            <button
              key={m.id}
              type="button"
              className={m.isDefault ? "active" : ""}
              disabled={
                busy ||
                dirty ||
                !m.enabled ||
                !m.keyConfigured ||
                m.health !== "ok"
              }
              onClick={() => void run(() => chooseDefault(m))}
            >
              <strong>{m.name || "新模型"}</strong>
              <span>
                {m.enabled ? "当前已启用" : "当前已停用"} ·{" "}
                {m.keyConfigured ? "Key 已配置" : "Key 未配置"}
              </span>
              <span>
                上次健康检查：{health(m.health)} · {beijingTime(m.checkedAt)}
                {m.latencyMs != null ? ` · ${m.latencyMs} ms` : ""}
              </span>
            </button>
          ))}
          {!models.length && (
            <p>还没有模型。下方选择提供商并添加，系统会自动填写接口地址。</p>
          )}
        </div>
      </div>
      <div className="ms-usage-panel">
        <div className="ms-heading">
          <h2>模型用量与费用</h2>
          <div className="ms-actions">
            <button disabled={refreshing} onClick={() => void refreshUsage()}>
              {refreshing ? "刷新中…" : "刷新统计"}
            </button>
            <button disabled={!rows.length} onClick={exportCSV}>
              导出费用 CSV
            </button>
          </div>
        </div>
        <div className="ms-usage-cards">
          {cards.map((c) => (
            <article key={c.key}>
              <span>{c.label}</span>
              <strong>{money(c.summary.cost, c.summary.unknown)}</strong>
              <small>
                {c.summary.calls} 次调用 · 失败 {c.summary.failures} · 进行中{" "}
                {c.summary.pending}
              </small>
              <small>
                均次{" "}
                {c.summary.unknown
                  ? "待确认"
                  : rmb(
                      c.summary.calls ? c.summary.cost / c.summary.calls : 0,
                    )}{" "}
                · {tokens(c.summary.tokens)} tokens
                {c.summary.unknownUsage ? "（部分用量待确认）" : ""}
              </small>
            </article>
          ))}
        </div>
        <p className="ms-help">
          按北京时间统计。套餐、未配置价格或未返回用量的调用单独标注待确认；费用为估算，不代替供应商账单。
        </p>
        <div className="ms-bars">
          {bars.map((r) => (
            <div className="ms-bar-row" key={r.id}>
              <span>{r.name}</span>
              <div>
                <i
                  style={{
                    width: `${totalCost ? (r.cost / totalCost) * 100 : 0}%`,
                  }}
                />
              </div>
              <strong>
                {money(r.cost, r.unknown)} ·{" "}
                {totalCost
                  ? `${((r.cost / totalCost) * 100).toFixed(1)}% 已知费用`
                  : "—"}{" "}
                · {r.calls} 次
              </strong>
            </div>
          ))}
          {!bars.length && <p>还没有 AI 调用记录。</p>}
        </div>
      </div>
      <details
        className="ms-details"
        open={apiOpen}
        onToggle={(e) => setApiOpen(e.currentTarget.open)}
      >
        <summary>模型 API、价格与健康检查</summary>
        <div className="ms-health-summary">
          <strong>
            {models.filter((m) => m.health === "ok").length}/{models.length}{" "}
            个模型上次检查可用
          </strong>
          <span>
            当前启用状态与上次检查结果分别展示。启用且检查通过的模型才会出现在前台。
          </span>
          <button
            disabled={busy || !models.length}
            onClick={() => void run(() => check())}
          >
            {dirty ? "保存并检查所有模型" : "检查所有已启用模型"}
          </button>
        </div>
        <div className="ms-actions">
          <select
            aria-label="新增模型提供商"
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
            disabled={busy}
          >
            {Object.entries(providers).map(([p, v]) => (
              <option key={p} value={p}>
                {v.name}
              </option>
            ))}
          </select>
          <button disabled={busy || models.length >= 40} onClick={add}>
            ＋ 添加模型
          </button>
        </div>
        <div className="ms-model-list">
          {models.map((m) => (
            <article
              className="ms-model-row"
              key={m.id}
              data-testid={`model-${m.id}`}
            >
              <div className="ms-row-top">
                <label>
                  <input
                    type="radio"
                    name="default-model"
                    checked={m.isDefault}
                    disabled={
                      busy ||
                      dirty ||
                      !m.enabled ||
                      !m.keyConfigured ||
                      m.health !== "ok"
                    }
                    onChange={() => void run(() => chooseDefault(m))}
                  />
                  默认
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={m.enabled}
                    disabled={busy}
                    onChange={(e) =>
                      update(m.id, { enabled: e.target.checked })
                    }
                  />
                  启用
                </label>
                <span className={`ms-pill ${m.enabled ? "enabled" : ""}`}>
                  {m.enabled ? "当前已启用" : "当前已停用"}
                </span>
                <span
                  className={`ms-pill ${m.health === "ok" ? "ok" : m.health === "unchecked" ? "" : "failed"}`}
                >
                  上次检查：{health(m.health)}
                </span>
                <small>
                  {beijingTime(m.checkedAt)}
                  {m.latencyMs != null ? ` · ${m.latencyMs} ms` : ""}
                </small>
                <button
                  disabled={busy}
                  onClick={() => void run(() => check(m.id))}
                >
                  {dirty ? "保存并检查此模型" : "检查此模型"}
                </button>
                {!m.revision && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      setModels((x) => x.filter((r) => r.id !== m.id))
                    }
                  >
                    移除未保存项
                  </button>
                )}
              </div>
              <div className="ms-edit-grid">
                <label className="field">
                  <span>显示名称</span>
                  <input
                    value={m.name}
                    maxLength={80}
                    disabled={busy}
                    onChange={(e) => update(m.id, { name: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Provider · 提供商</span>
                  <select
                    value={m.provider}
                    disabled={busy}
                    onChange={(e) => {
                      const p = e.target.value as Provider;
                      update(m.id, {
                        provider: p,
                        baseUrl: providers[p].baseUrl,
                        isDefault: false,
                      });
                    }}
                  >
                    {Object.entries(providers).map(([p, v]) => (
                      <option key={p} value={p}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Model name · 供应商型号</span>
                  <input
                    value={m.model}
                    maxLength={120}
                    disabled={busy}
                    onChange={(e) =>
                      update(m.id, { model: e.target.value, isDefault: false })
                    }
                    placeholder="填写供应商提供的模型 ID"
                  />
                </label>
                <label className="field">
                  <span>Base URL · API 基础地址</span>
                  <input
                    value={m.baseUrl}
                    maxLength={1000}
                    disabled={busy}
                    onChange={(e) =>
                      update(m.id, {
                        baseUrl: e.target.value,
                        isDefault: false,
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>API Key</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={m.apiKey ?? ""}
                    maxLength={4096}
                    disabled={busy || !settings.keyEntryReady}
                    placeholder={
                      m.keyConfigured ? "已配置，留空不覆盖" : "未配置"
                    }
                    onChange={(e) =>
                      update(m.id, { apiKey: e.target.value, isDefault: false })
                    }
                  />
                </label>
                <label className="field">
                  <span>币种</span>
                  <select
                    aria-label="币种"
                    value={m.currency}
                    disabled={busy}
                    onChange={(e) =>
                      update(m.id, {
                        currency: e.target.value as "CNY" | "USD",
                      })
                    }
                  >
                    <option>CNY</option>
                    <option>USD</option>
                  </select>
                </label>
                {(["inputPrice", "outputPrice", "requestPrice"] as const).map(
                  (key, i) => (
                    <label className="field" key={key}>
                      <span>
                        {
                          [
                            "输入 / 百万 Token",
                            "输出 / 百万 Token",
                            "单请求费用",
                          ][i]
                        }
                      </span>
                      <input
                        type="number"
                        min="0"
                        max="10000"
                        step="any"
                        value={m[key] ?? ""}
                        disabled={busy}
                        placeholder="未知请留空"
                        onChange={(e) =>
                          update(m.id, {
                            [key]:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  ),
                )}
                <label className="field">
                  <span>价格来源</span>
                  <input
                    type="url"
                    value={m.priceSource}
                    maxLength={2000}
                    disabled={busy}
                    placeholder="https://…"
                    onChange={(e) =>
                      update(m.id, { priceSource: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>计费方式</span>
                  <select
                    value={m.billingMode}
                    disabled={busy}
                    onChange={(e) =>
                      update(m.id, {
                        billingMode: e.target.value as AIModel["billingMode"],
                      })
                    }
                  >
                    <option value="tokens">按 Token</option>
                    <option value="request">按请求</option>
                    <option value="tokens_request">Token + 请求</option>
                    <option value="plan">套餐 / 待确认</option>
                  </select>
                </label>
                <label className="field ms-note">
                  <span>价格备注 / 套餐说明</span>
                  <input
                    value={m.priceNote}
                    maxLength={1000}
                    disabled={busy}
                    onChange={(e) =>
                      update(m.id, { priceNote: e.target.value })
                    }
                  />
                </label>
              </div>
              <div className="ms-row-foot">
                <span>
                  {m.billingMode === "plan"
                    ? "套餐费用不按 Token 推算"
                    : `输入 ${m.inputPrice ?? "待确认"} / 输出 ${m.outputPrice ?? "待确认"} ${m.currency}/百万 Token；单请求 ${m.requestPrice ?? "待确认"} ${m.currency}`}
                </span>
                {m.health !== "ok" && m.health !== "unchecked" && (
                  <span className="ms-error">{message(Error(m.health))}</span>
                )}
                {m.priceSource && /^https:\/\//i.test(m.priceSource) && (
                  <a href={m.priceSource} target="_blank" rel="noreferrer">
                    查看价格来源 ↗
                  </a>
                )}
              </div>
              <AIModelFeedback
                model={m}
                disabled={busy}
                onPatch={(patch) => update(m.id, patch)}
              />
            </article>
          ))}
        </div>
        <p className="ms-help">
          显示名称可自己命名；Model name 必须与供应商一致。新增示例参考本机 DIG
          配置，可用性以当前账户健康检查为准。Base URL 不填完整的
          chat/completions 路径；支持所列厂商官方地址与
          OpenRouter。每个模型独立保存 Key，留空保留原 Key。
        </p>
        <label className="field ms-fx">
          <span>人民币折算：1 USD = 多少 CNY</span>
          <input
            type="number"
            step="any"
            min="0.01"
            max="100"
            disabled={busy}
            value={billing.usdToCny ?? ""}
            placeholder="未知请留空"
            onChange={(e) =>
              setBilling({
                usdToCny: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
        </label>
        <p className="ms-help">
          此汇率由管理员填写，仅用于后续调用；未知时美元费用保留原币种，人民币部分标为待确认，不改写历史账目。
        </p>
      </details>
      <details className="ms-details">
        <summary>明细表</summary>
        {cards.map((c) => (
          <div key={c.key}>{table(c.label, c.rows)}</div>
        ))}
      </details>
      <details className="ms-details">
        <summary>运维自检与后台任务</summary>
        <div className="ms-heading">
          <h2>后台状态</h2>
          <button disabled={opsBusy} onClick={() => void ops()}>
            {opsBusy ? "检查中…" : "刷新自检"}
          </button>
        </div>
        {diagnostics ? (
          <>
            <div className="ms-ops-cards">
              {[
                {
                  name: "基础服务",
                  value:
                    diagnostics.worker &&
                    diagnostics.database &&
                    diagnostics.storage
                      ? "正常"
                      : "需关注",
                  note: `Worker / D1 / R2：${diagnostics.worker ? "✓" : "×"} / ${diagnostics.database ? "✓" : "×"} / ${diagnostics.storage ? "✓" : "×"}`,
                },
                {
                  name: "密钥与邮件",
                  value:
                    diagnostics.encryption && diagnostics.email
                      ? "已配置"
                      : "需配置",
                  note: `加密存储 ${diagnostics.encryption ? "✓" : "×"} · 邮件 ${diagnostics.email ? "✓" : "×"}`,
                },
                {
                  name: "AI 调用（90天）",
                  value: `${diagnostics.ai?.calls ?? 0} 次`,
                  note: `${diagnostics.ai?.failures ?? 0} 失败 · ${diagnostics.ai?.pending ?? 0} 进行中 · ${diagnostics.ai?.stale ?? 0} 超时待核实`,
                },
                {
                  name: "邮件任务",
                  value: `${diagnostics.mail.reduce((n: number, r: any) => n + r.count, 0)} 次`,
                  note: diagnostics.mail
                    .map((r: any) => `${statusLabel(r.state)} ${r.count}`)
                    .join(" · "),
                },
              ].map((r) => (
                <article key={r.name}>
                  <span>{r.name}</span>
                  <strong>{r.value}</strong>
                  <small>{r.note}</small>
                </article>
              ))}
            </div>
            <p className="ms-help">
              检查时间：{beijingTime(diagnostics.checkedAt)}
              （北京时间）。自检只读取状态，不发起 AI 调用或发送邮件。
            </p>
            <div className="ms-actions">
              <select
                aria-label="后台任务状态"
                value={taskStatus}
                onChange={(e) => setTaskStatus(e.target.value)}
              >
                <option value="">全部状态</option>
                {Array.from(
                  new Set<string>(diagnostics.recent.map((r: any) => r.status)),
                ).map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
              <select
                aria-label="后台任务类型"
                value={taskType}
                onChange={(e) => setTaskType(e.target.value)}
              >
                <option value="">全部任务</option>
                {Array.from(
                  new Set<string>(diagnostics.recent.map((r: any) => r.type)),
                ).map((s) => (
                  <option key={s} value={s}>
                    {purpose(s)}
                  </option>
                ))}
              </select>
            </div>
            <div className="ms-table-wrap">
              <table>
                <thead>
                  <tr>
                    {[
                      "任务",
                      "状态",
                      "耗时",
                      "错误",
                      "发起人",
                      "发起时间（北京时间）",
                    ].map((s) => (
                      <th key={s}>{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((r: any) => (
                    <tr key={r.id}>
                      <td>{purpose(r.type)}</td>
                      <td>{statusLabel(r.status)}</td>
                      <td>
                        {r.latency_ms == null ? "—" : `${r.latency_ms} ms`}
                      </td>
                      <td>
                        {r.diagnostic_json ? (
                          <AIDiagnosticView
                            diagnostic={JSON.parse(r.diagnostic_json)}
                          />
                        ) : r.error_code ? (
                          message(Error(r.error_code))
                        ) : (
                          "—"
                        )}
                      </td>
                      <td title={r.email}>{r.caller ?? "—"}</td>
                      <td>{beijingTime(r.updated_at)}</td>
                    </tr>
                  ))}
                  {!tasks.length && (
                    <tr>
                      <td colSpan={6}>没有匹配的后台任务。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="ms-help">
              最近 100
              条任务；上方费用统计独立汇总完整期间，不受此列表条数限制。PowerMatch
              当前任务为 AI 调用和邮件投递。
            </p>
          </>
        ) : (
          <p>
            点击“刷新自检”查看 Worker、D1、R2、密钥、AI 调用和邮件任务状态。
          </p>
        )}
      </details>
      <div className="ms-save-bar">
        <button
          className="primary"
          disabled={busy || !dirty}
          onClick={() => void run(save)}
        >
          {busy ? "处理中…" : "保存模型设置"}
        </button>
        <span>仅 Patrick 可修改配置。API Key 保存后不会在页面回显。</span>
      </div>
      {(status || loadError) && (
        <p className="ms-status" role="status">
          {status || loadError}
        </p>
      )}
    </section>
  );
}

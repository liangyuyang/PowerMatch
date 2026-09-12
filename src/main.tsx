import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BatteryFull as Battery,
  Sun,
  Lightning,
  FloppyDisk,
  Copy,
  Download,
  Plus,
  X,
  SlidersHorizontal,
  Columns,
  Books,
  Globe,
  Chats,
  ShieldCheck,
  ArrowRight,
  CheckCircle,
  Warning,
  Envelope,
  Trash,
} from "@phosphor-icons/react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LineChart,
  Line,
  Legend,
} from "recharts";
import {
  cloneDesign,
  DEFAULT_DESIGN,
  chooseLocale,
  locales,
  changeStorage,
  designSchema,
  type Design,
  type Viewer,
  type Scope,
  type Component,
  type Locale,
} from "./shared/model";
import { calculate, type Result } from "./shared/engine";
import { CATALOG } from "./shared/catalog";
import { t, explain, languageNames, type Word } from "./i18n";
import "./style.css";
import { AIAdmin, AIAssistant } from "./ai-ui";
import { selectComponent } from "./shared/assistant";

async function api(path: string, data?: unknown, method?: string) {
  const response = await fetch("/api" + path, {
    method: method ?? (data ? "POST" : "GET"),
    headers:
      data instanceof FormData
        ? {}
        : data
          ? { "Content-Type": "application/json" }
          : {},
    body:
      data instanceof FormData ? data : data ? JSON.stringify(data) : undefined,
  });
  const result: any = await response.json();
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result;
}
const fmt = (n: number, d = 2) => Number(n.toFixed(d)).toString();
const human = (name: string) =>
  name ? name[0].toUpperCase() + name.slice(1) : "ZenMeasure";
const date = (s: string) => s.slice(0, 10);
type CaseItem = {
  id: string;
  name: string;
  scope: Scope;
  latest_revision: number;
  official: number;
  author_name?: string;
  author_id?: string;
  updated_at: string;
};
type Revision = {
  id: string;
  number: number;
  design: Design;
  created_at: string;
};
type Modal =
  | "newcomponent"
  | "login"
  | "save"
  | "component"
  | "messages"
  | "delete"
  | null;
function ModalShell({
  title,
  onClose,
  children,
  variant,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  variant?: "drawer";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current
      ?.querySelector<HTMLElement>("button,input,select,textarea")
      ?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab") {
        const list = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
          ) ?? [],
        );
        if (!list.length) return;
        const first = list[0],
          last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = before;
      document.removeEventListener("keydown", key);
      trigger?.focus();
    };
  }, []);
  return (
    <div
      className={variant === "drawer" ? "backdrop drawer-backdrop" : "backdrop"}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={variant === "drawer" ? "modal ai-drawer" : "modal"}
        ref={ref}
      >
        <div className="section-title">
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function App() {
  const [aiOpen, setAiOpen] = useState(false);
  const [picker, setPicker] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [undoAI, setUndoAI] = useState<{
    before: Design;
    after: Design;
  } | null>(null);
  const [preference, setPreference] = useState(
    () => localStorage.getItem("pm-language") ?? "auto",
  );
  const [locale, setLocale] = useState<Locale>(() =>
    chooseLocale(localStorage.getItem("pm-language"), navigator.languages),
  );
  const tr = (key: Word) => t(locale, key);
  const bi = (zh: string, en: string) => (locale === "zh" ? zh : en);
  const [page, setPage] = useState<Word>("workbench"),
    [d, setD] = useState<Design>(cloneDesign),
    [viewer, setViewer] = useState<Viewer | null>(null),
    [emailReady, setEmailReady] = useState(false),
    [modal, setModal] = useState<Modal>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(""),
    [scope, setScope] = useState<Scope>("public"),
    [cases, setCases] = useState<CaseItem[]>([]),
    [hallScope, setHallScope] = useState("public"),
    [current, setCurrent] = useState<{
      id: string;
      revision: number;
      parent: string;
      canEdit: boolean;
    } | null>(null),
    [revisions, setRevisions] = useState<Revision[]>([]),
    [components, setComponents] = useState<Component[]>(CATALOG),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Component | null>(null),
    [specs, setSpecs] = useState<any[]>([]),
    [params, setParams] = useState("{}"),
    [reviewNote, setReviewNote] = useState(""),
    [uploadFile, setUploadFile] = useState<File | null>(null),
    [candidates, setCandidates] = useState<any[]>([]),
    [snapshots, setSnapshots] = useState<Design[]>(() => {
      const battery = cloneDesign();
      battery.mode = "battery";
      battery.name = "CR2032 · Battery";
      const lic = changeStorage(cloneDesign(), "lic");
      lic.mode = "hybrid";
      lic.name = "PV + LIC 1F";
      return [battery, lic];
    }),
    [lockConditions, setLockConditions] = useState(true),
    [postBody, setPostBody] = useState(""),
    [posts, setPosts] = useState<any[]>([]),
    [target, setTarget] = useState({ type: "application", target: "general" }),
    [recipient, setRecipient] = useState(""),
    [messageBody, setMessageBody] = useState(""),
    [messages, setMessages] = useState<any[]>([]),
    [admin, setAdmin] = useState<any>(null),
    [loginToken, setLoginToken] = useState(() =>
      new URLSearchParams(location.hash.slice(1)).get("token"),
    );
  const [report, setReport] = useState(false),
    [partName, setPartName] = useState(""),
    [partMaker, setPartMaker] = useState(""),
    [partCategory, setPartCategory] = useState("battery"),
    [partSource, setPartSource] = useState("");
  const valid = designSchema.safeParse(d);
  const result = useMemo(() => {
    try {
      return calculate(d);
    } catch {
      return null;
    }
  }, [d]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    api("/session")
      .then((x) => {
        setViewer(x.user);
        setEmailReady(x.emailConfigured);
        if (x.user) {
          const p = x.user.localeMode === "manual" ? x.user.locale : "auto";
          setPreference(p);
          setLocale(chooseLocale(p, navigator.languages));
          localStorage.setItem("pm-language", p);
        }
      })
      .catch(() =>
        setNotice(
          bi(
            "服务暂时未连接，计算可继续；保存需等待服务恢复。",
            "Server unavailable. Calculation remains local; saving requires the server.",
          ),
        ),
      );
    api("/components")
      .then((x) => setComponents(x.components))
      .catch(() => {});
    if (loginToken) {
      history.replaceState({}, "", location.pathname);
      setModal("login");
    }
    const handle = () => {
      if (localStorage.getItem("pm-language") === "auto")
        setLocale(chooseLocale(null, navigator.languages));
    };
    window.addEventListener("languagechange", handle);
    const after = () => setReport(false);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("languagechange", handle);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  useEffect(() => {
    if (page === "hall")
      run(async () => setCases((await api("/cases?scope=" + hallScope)).cases));
    if (page === "forum")
      run(async () =>
        setPosts(
          (
            await api(
              `/posts?type=${target.type}&target=${encodeURIComponent(target.target)}`,
            )
          ).posts,
        ),
      );
    if (page === "admin" && viewer?.admin)
      run(async () => setAdmin(await api("/admin")));
  }, [page, hallScope, target, viewer?.admin]);
  const update = (group: keyof Design, key: string, value: unknown) =>
    setD((old) => ({
      ...old,
      [group]: { ...(old[group] as object), [key]: value },
    }));
  const number = (
    label: string,
    value: number | null,
    onChange: (n: number | null) => void,
    base?: number | null,
    nullable = false,
  ) => (
    <label
      className={
        "field " +
        (value === null
          ? "missing"
          : base !== undefined && value !== base
            ? "modified"
            : "")
      }
    >
      <span>
        {label}
        <small>
          {value === null
            ? tr("pending")
            : base !== undefined && value !== base
              ? tr("changed")
              : tr("default")}
        </small>
      </span>
      <input
        type="number"
        step="any"
        value={value ?? ""}
        placeholder="—"
        onChange={(e) =>
          onChange(
            e.target.value === ""
              ? nullable
                ? null
                : 0
              : Number(e.target.value),
          )
        }
      />
    </label>
  );
  const field = (
    group: "load" | "light" | "pv" | "storage" | "regulation",
    key: string,
    label: string,
    nullable = false,
  ) =>
    number(
      label,
      (d[group] as any)[key],
      (v) => update(group, key, v),
      (DEFAULT_DESIGN[group] as any)[key],
      nullable,
    );
  const select = (
    label: string,
    value: string,
    options: [string, string][],
    change: (s: string) => void,
  ) => (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => change(e.target.value)}>
        {options.map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
  const runtime = (r: Result | null, dark = false) =>
    !r || r.status !== "conditional"
      ? "—"
      : (dark ? r.darkHours : r.runtimeHours) === null
        ? `≥ ${d.horizonDays * 24} h`
        : `${fmt((dark ? r.darkHours : r.runtimeHours)!)} h`;
  const openCase = async (id: string, duplicate = false) =>
    run(async () => {
      const x = await api("/cases/" + id);
      setD(x.revisions[0].design);
      setCurrent({
        id,
        revision: x.case.latest_revision,
        parent: x.revisions[0].id,
        canEdit: !!x.case.canEdit && !duplicate,
      });
      setRevisions(x.revisions);
      setScope(duplicate ? "public" : x.case.scope);
      setPage("workbench");
      if (duplicate)
        setNotice(
          bi(
            "已复制，保存时创建新方案。",
            "Copied. Saving creates a new case.",
          ),
        );
    });
  const showComponent = async (c: Component) => {
    setSelected(c);
    setParams(JSON.stringify(c.parameters, null, 2));
    setReviewNote("");
    setCandidates([]);
    setModal("component");
    run(async () =>
      setSpecs((await api("/components/" + c.id + "/specs")).specs),
    );
  };
  const useComponent = (c: Component) => {
    const p = c.parameters;
    setD((old) => {
      const n = cloneDesign(old);
      if (c.category === "battery") {
        n.mode = "battery";
        n.storage.kind = "primary";
        n.storage.componentId = c.id;
        n.storage.voltage = typeof p.voltage === "number" ? p.voltage : null;
        n.storage.capacityMah =
          typeof p.capacityMah === "number" ? p.capacityMah : null;
        n.storage.minVoltage =
          typeof p.minVoltage === "number" ? p.minVoltage : 1;
        n.storage.maxVoltage = n.storage.voltage;
        n.storage.esr = typeof p.esr === "number" ? p.esr : null;
        n.storage.series = 1;
        n.storage.parallel = 1;
      } else if (["lic", "supercapacitor", "supercap"].includes(c.category)) {
        n.mode = "hybrid";
        n.storage.kind = c.category === "lic" ? "lic" : "supercap";
        n.storage.componentId = c.id;
        n.storage.farads = typeof p.farads === "number" ? p.farads : null;
        n.storage.minVoltage =
          typeof p.minVoltage === "number" ? p.minVoltage : null;
        n.storage.maxVoltage =
          typeof p.maxVoltage === "number" ? p.maxVoltage : null;
        n.storage.leakUa = typeof p.leakUa === "number" ? p.leakUa : null;
        n.storage.esr = typeof p.esr === "number" ? p.esr : null;
      } else if (c.category === "pv") {
        n.pv.componentId = c.id;
        n.pv.densityUwCm2 =
          typeof p.densityUwCm2 === "number" ? p.densityUwCm2 : null;
        n.pv.voltage = null;
        n.mode = "pv";
      } else if (c.category === "ldo" || c.category === "pmic") {
        n.regulation.componentId = c.id;
        n.path = c.category === "ldo" ? "ldo" : "converter";
        n.regulation.iqUa = typeof p.iqUa === "number" ? p.iqUa : null;
        n.regulation.mppt = String(p.mppt).toLowerCase() === "yes";
      }
      return n;
    });
    setModal(null);
    setPage("workbench");
  };
  const exportJson = () => {
    const blob = new Blob(
      [JSON.stringify({ format: "PowerMatch-0.1", design: d }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "powermatch-design.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const print = () => {
    setReport(true);
    setTimeout(() => window.print(), 100);
  };
  const chart = (r: Result | null) => (
    <div className="chart">
      {r?.trace.length ? (
        <ResponsiveContainer width="100%" height={210}>
          <AreaChart data={r.trace}>
            <defs>
              <linearGradient id="energy" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 5" vertical={false} />
            <XAxis
              dataKey="hour"
              type="number"
              domain={[0, "dataMax"]}
              tickCount={5}
              unit="h"
              tickFormatter={(n) => fmt(n, 0)}
            />
            <YAxis domain={[0, 100]} unit="%" />
            <Tooltip labelFormatter={(n) => `${fmt(Number(n))} h`} />
            <Area
              type="monotone"
              dataKey="percent"
              name={tr("storage")}
              stroke="#2563eb"
              fill="url(#energy)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="empty">
          <Warning size={28} />
          <p>{tr("incomplete")}</p>
          <small>
            {bi(
              "补齐参数后显示能量随时间变化。",
              "Complete the parameters to plot stored energy over time.",
            )}
          </small>
        </div>
      )}
    </div>
  );
  const flow = (
    <div className="energy-flow">
      <button
        className="component-node"
        onClick={() => setPicker(d.mode === "battery" ? "storage" : "pv")}
      >
        <Sun size={28} />
        <span>{d.mode === "battery" ? tr("battery") : tr("pv")}</span>
        {d.mode !== "battery" && (
          <img src="/assets/indoor-pv.png" alt="Generic indoor PV" />
        )}
      </button>
      <ArrowRight className="flow-arrow" />
      <button
        className="component-node"
        onClick={() => setPicker("regulation")}
      >
        <Lightning size={28} />
        <span>{d.path.toUpperCase()}</span>
        <small>{d.regulation.mppt ? "MPPT ✓" : "MPPT —"}</small>
      </button>
      {d.mode !== "pv" && (
        <>
          <ArrowRight className="flow-arrow" />
          <button
            className="component-node"
            onClick={() => setPicker("storage")}
          >
            <Battery size={28} />
            <span>{d.storage.componentId}</span>
            <small>
              {d.storage.series}S{d.storage.parallel}P
            </small>
          </button>
        </>
      )}
      <ArrowRight className="flow-arrow" />
      <button className="component-node" onClick={() => setPicker("device")}>
        <img
          src={
            d.device === "MHO-C404"
              ? "/assets/MHO-C404-body-white.png"
              : "/assets/MOT-U125-body-white.png"
          }
          alt={d.device}
        />
        <span>{d.device}</span>
        <small>{d.load.voltage} V</small>
      </button>
    </div>
  );
  return (
    <>
      <header>
        <a href="/" className="brand">
          <img src="/assets/zenmeasure-blue.png" alt="ZenMeasure" />
          <span>
            PowerMatch<small>ENERGY DESIGN STUDIO</small>
          </span>
        </a>
        <nav>
          {(["workbench", "compare", "library", "hall", "forum"] as Word[]).map(
            (key, i) => (
              <button
                key={key}
                className={page === key ? "active" : ""}
                onClick={() => setPage(key)}
              >
                {
                  [
                    <SlidersHorizontal />,
                    <Columns />,
                    <Books />,
                    <Globe />,
                    <Chats />,
                  ][i]
                }
                {tr(key)}
              </button>
            ),
          )}
          {viewer?.admin && (
            <button onClick={() => setPage("admin")}>
              <ShieldCheck />
              {tr("admin")}
            </button>
          )}
        </nav>
        <div className="account">
          <select
            aria-label="Language"
            value={preference}
            onChange={(e) => {
              const p = e.target.value;
              setPreference(p);
              localStorage.setItem("pm-language", p);
              const next = chooseLocale(p, navigator.languages);
              setLocale(next);
              if (viewer)
                run(async () => {
                  await api(
                    "/preferences",
                    { locale: next, mode: p === "auto" ? "auto" : "manual" },
                    "PATCH",
                  );
                });
            }}
          >
            <option value="auto">{tr("auto")}</option>
            {locales.map((l, i) => (
              <option value={l} key={l}>
                {languageNames[i]}
              </option>
            ))}
          </select>
          {viewer ? (
            <>
              <button
                onClick={() => {
                  setModal("messages");
                  run(async () =>
                    setMessages((await api("/messages")).messages),
                  );
                }}
              >
                <Envelope />
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    await api("/auth/logout", {});
                    setViewer(null);
                  })
                }
              >
                {viewer.name} · Lv{viewer.level} · {tr("logout")}
              </button>
            </>
          ) : (
            <button onClick={() => setModal("login")}>{tr("login")}</button>
          )}
        </div>
      </header>
      <main>
        <div className="page-title">
          <div>
            <div className="eyebrow">ZENMEASURE / POWERMATCH</div>
            <h1>{tr(page)}</h1>
            <p>
              {bi(
                "让每一微瓦，都有清晰的答案。",
                "Understand every microwatt. Design for real conditions.",
              )}
            </p>
          </div>
          {["workbench", "compare"].includes(page) && (
            <div className="toolbar">
              <button onClick={() => setAiOpen(true)}>
                <Chats />
                {bi("AI 设计助手", "AI assistant")}
              </button>
              {undoAI && (
                <button
                  disabled={JSON.stringify(d) !== JSON.stringify(undoAI.after)}
                  onClick={() => {
                    setD(undoAI.before);
                    setUndoAI(null);
                  }}
                >
                  {bi("撤销 AI 调整", "Undo AI changes")}
                </button>
              )}
              <button
                onClick={() => {
                  setSnapshots((s) => [...s.slice(-2), cloneDesign(d)]);
                  setPage("compare");
                }}
              >
                <Plus />
                {tr("compare")}
              </button>
              <button onClick={print}>
                <Download />
                {tr("report")}
              </button>
              <button
                className="primary"
                onClick={() => setModal("save")}
                disabled={!valid.success}
              >
                <FloppyDisk />
                {tr("save")}
              </button>
            </div>
          )}
        </div>
        {notice && (
          <div role="status" className="notice">
            {notice}
            <button onClick={() => setNotice("")} aria-label={tr("close")}>
              <X />
            </button>
          </div>
        )}
        {page === "workbench" && (
          <>
            <div className="design-bar">
              <input
                aria-label={tr("name")}
                value={d.name}
                onChange={(e) => setD({ ...d, name: e.target.value })}
              />
              <span className="badge">{tr(scope)}</span>
              <span className="badge muted">
                {current ? `v${current.revision}` : "DRAFT"}
              </span>
              <button
                onClick={() => {
                  setCurrent(current ? { ...current, canEdit: false } : null);
                  setD({ ...d, name: d.name + " · Copy" });
                }}
              >
                <Copy />
                {tr("copy")}
              </button>
            </div>
            <div className="workspace">
              <aside className="panel inputs">
                <div className="section-title">
                  <h2>01 · {tr("device")}</h2>
                  <span className="dot-label">
                    {tr("default")} / <b>{tr("changed")}</b>
                  </span>
                </div>
                {select(
                  tr("device"),
                  d.device,
                  [
                    ["MOT-U125", "穿山甲Tiny · MOT-U125"],
                    ["MHO-C404", "秒秒测微光能温湿度计 · MHO-C404"],
                    ["custom", bi("自定义设备", "Custom device")],
                  ],
                  (v) => {
                    if (v === "MOT-U125")
                      setD({ ...d, device: v, load: cloneDesign().load });
                    else if (v === "MHO-C404")
                      setD({
                        ...d,
                        device: v,
                        load: {
                          voltage: 3,
                          minVoltage: 2,
                          maxVoltage: 3.3,
                          phases: [
                            { name: "Unconfirmed", seconds: 1, currentUa: 0 },
                          ],
                        },
                      });
                    else setD({ ...d, device: "custom" });
                  },
                )}
                {d.device === "MHO-C404" && (
                  <p className="warning">
                    {bi(
                      "彩页没有耗电曲线。请填入实测电流；当前 0µA 为待填占位，不代表产品功耗。",
                      "Brochure lacks a load profile. Enter measured current; 0 µA is an unconfirmed placeholder.",
                    )}
                  </p>
                )}
                <div className="grid2">
                  {field("load", "voltage", tr("voltage"))}
                  {field("load", "minVoltage", tr("minVoltage"))}
                  {field("load", "maxVoltage", tr("maxVoltage"))}
                </div>
                <h3>{tr("phase")}</h3>
                {d.load.phases.map((p, i) => (
                  <div className="phase" key={i}>
                    <input
                      aria-label={tr("phase")}
                      value={p.name}
                      onChange={(e) =>
                        setD({
                          ...d,
                          load: {
                            ...d.load,
                            phases: d.load.phases.map((v, j) =>
                              i === j ? { ...v, name: e.target.value } : v,
                            ),
                          },
                        })
                      }
                    />
                    <div className="grid2">
                      {number(
                        tr("seconds"),
                        p.seconds,
                        (n) =>
                          setD({
                            ...d,
                            load: {
                              ...d.load,
                              phases: d.load.phases.map((v, j) =>
                                i === j ? { ...v, seconds: n ?? 0 } : v,
                              ),
                            },
                          }),
                        DEFAULT_DESIGN.load.phases[i]?.seconds,
                      )}
                      {number(
                        tr("current"),
                        p.currentUa,
                        (n) =>
                          setD({
                            ...d,
                            load: {
                              ...d.load,
                              phases: d.load.phases.map((v, j) =>
                                i === j ? { ...v, currentUa: n ?? 0 } : v,
                              ),
                            },
                          }),
                        DEFAULT_DESIGN.load.phases[i]?.currentUa,
                      )}
                    </div>
                    {d.load.phases.length > 1 && (
                      <button
                        className="text-button"
                        onClick={() =>
                          setD({
                            ...d,
                            load: {
                              ...d.load,
                              phases: d.load.phases.filter((_, j) => i !== j),
                            },
                          })
                        }
                      >
                        {tr("delete")}
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() =>
                    setD({
                      ...d,
                      load: {
                        ...d.load,
                        phases: [
                          ...d.load.phases,
                          { name: "Phase", seconds: 1, currentUa: 0 },
                        ],
                      },
                    })
                  }
                >
                  <Plus />
                  {tr("add")}
                </button>
                <div className="mini-result">
                  {tr("average")}
                  <strong>
                    {fmt(result?.averageUa ?? 0)} <small>µA</small>
                  </strong>
                </div>
                <details>
                  <summary>{tr("notes")}</summary>
                  <textarea
                    value={d.notes}
                    onChange={(e) => setD({ ...d, notes: e.target.value })}
                  />
                </details>
              </aside>
              <section className="center">
                <div className="panel">
                  <div className="section-title">
                    <h2>02 · {tr("source")}</h2>
                    <span className="badge">LIVE MODEL</span>
                  </div>
                  <div className="segmented">
                    {(["battery", "pv", "hybrid"] as const).map((v) => (
                      <button
                        className={d.mode === v ? "selected" : ""}
                        key={v}
                        onClick={() => setD({ ...d, mode: v })}
                      >
                        {v === "battery" ? <Battery /> : <Sun />}
                        {tr(v)}
                      </button>
                    ))}
                  </div>
                  {flow}
                  <p className="caption">
                    {bi(
                      "能量路径示意 · 元器件图不代表可投产原理图",
                      "Energy path · illustrative components, not a production schematic",
                    )}
                  </p>
                </div>
                {d.mode !== "battery" && (
                  <div className="panel">
                    <h2>
                      <Sun /> {tr("light")}
                    </h2>
                    {select(
                      tr("light"),
                      d.light.source,
                      [
                        [
                          "office",
                          bi("办公室复合照明", "Office mixed lighting"),
                        ],
                        ["home", bi("家庭复合照明", "Home mixed lighting")],
                        ["led-warm", "LED 2700 K"],
                        ["led-neutral", "LED 4000 K"],
                        ["led-cool", "LED 6500 K"],
                        ["daylight", bi("窗边日光", "Window daylight")],
                      ],
                      (v) => update("light", "source", v),
                    )}
                    <div className="grid3">
                      {field("light", "lux", tr("lux"))}
                      {field("light", "days", tr("days"))}
                      {field("light", "hours", tr("hours"))}
                      {field("light", "startHour", tr("start"))}
                      {field("light", "angle", tr("angle"))}
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={d.light.planeMeasured}
                        onChange={(e) =>
                          update("light", "planeMeasured", e.target.checked)
                        }
                      />
                      {bi(
                        "照度已在光伏板平面测量（不重复按角度折减）",
                        "Illuminance measured on the panel plane (no double angle correction)",
                      )}
                    </label>
                    <div className="week">
                      {["M", "T", "W", "T", "F", "S", "S"].map((v, i) => (
                        <div key={i} className={i < d.light.days ? "lit" : ""}>
                          {v}
                          <span>{i < d.light.days ? d.light.hours : 0} h</span>
                        </div>
                      ))}
                    </div>
                    <h3>
                      {tr("pv")} · {d.pv.componentId}
                    </h3>
                    <div className="grid2">
                      {field("pv", "areaCm2", tr("area"))}
                      {field("pv", "densityUwCm2", tr("density"), true)}
                      {field("pv", "referenceLux", tr("referenceLux"))}
                      {field("pv", "voltage", tr("voltage"), true)}
                      {field(
                        "pv",
                        "utilization",
                        bi(
                          "非 MPPT 利用率 (0–1)",
                          "Non-MPPT utilization (0–1)",
                        ),
                      )}
                    </div>
                  </div>
                )}
                {d.mode !== "pv" && (
                  <div className="panel">
                    <h2>
                      <Battery /> {tr("storage")}
                    </h2>
                    {select(
                      tr("storage"),
                      d.storage.kind,
                      [
                        ["primary", bi("不可充电电池", "Primary battery")],
                        [
                          "rechargeable",
                          bi("可充电电池", "Rechargeable battery"),
                        ],
                        ["lic", bi("锂离子电容 LIC", "Lithium-ion capacitor")],
                        ["supercap", bi("超级电容", "Supercapacitor")],
                      ],
                      (v) =>
                        setD(changeStorage(d, v as Design["storage"]["kind"])),
                    )}
                    <p>{d.storage.componentId}</p>
                    <div className="grid2">
                      {field(
                        "storage",
                        "series",
                        bi("串联数量 S", "Cells in series S"),
                      )}
                      {field(
                        "storage",
                        "parallel",
                        bi("并联数量 P", "Parallel strings P"),
                      )}
                      {["lic", "supercap"].includes(d.storage.kind) ? (
                        field(
                          "storage",
                          "farads",
                          bi("单体电容 (F)", "Cell capacitance (F)"),
                          true,
                        )
                      ) : (
                        <>
                          {field(
                            "storage",
                            "capacityMah",
                            bi("单体容量 (mAh)", "Cell capacity (mAh)"),
                            true,
                          )}
                          {field("storage", "voltage", tr("voltage"), true)}
                        </>
                      )}
                      {field("storage", "minVoltage", tr("minVoltage"), true)}
                      {field("storage", "maxVoltage", tr("maxVoltage"), true)}
                      {field(
                        "storage",
                        "leakUa",
                        bi("单体漏电 (µA)", "Cell leakage (µA)"),
                        true,
                      )}
                      {field(
                        "storage",
                        "esr",
                        bi("单体内阻 (Ω)", "Cell ESR (Ω)"),
                        true,
                      )}
                      {field(
                        "storage",
                        "initialPercent",
                        bi("初始可用能量 (%)", "Initial usable energy (%)"),
                      )}
                    </div>
                  </div>
                )}
                <div className="panel">
                  <h2>
                    <Lightning /> {tr("regulation")}
                  </h2>
                  {select(
                    tr("regulation"),
                    d.path,
                    [
                      ["ldo", "LDO"],
                      ["converter", "DC/DC"],
                      ["direct", bi("直接连接", "Direct connection")],
                    ],
                    (v) => setD({ ...d, path: v as Design["path"] }),
                  )}
                  <div className="grid2">
                    {field(
                      "regulation",
                      "iqUa",
                      bi("静态电流 (µA)", "Quiescent current (µA)"),
                      true,
                    )}
                    {d.path === "ldo" &&
                      field(
                        "regulation",
                        "dropout",
                        bi("最低压差 (V)", "Required dropout (V)"),
                      )}
                    {d.path === "converter" &&
                      field(
                        "regulation",
                        "efficiency",
                        bi("负载转换效率 (0–1)", "Load efficiency (0–1)"),
                      )}
                    {d.mode === "hybrid" &&
                      field(
                        "regulation",
                        "harvestEfficiency",
                        bi("采能效率 (0–1)", "Harvest efficiency (0–1)"),
                      )}
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={d.regulation.mppt}
                      onChange={(e) =>
                        update("regulation", "mppt", e.target.checked)
                      }
                    />
                    MPPT{" "}
                    <small>
                      {bi(
                        "最大功率点追踪：调节采能工作点以获取更多功率。",
                        "Maximum power point tracking adjusts the harvesting operating point.",
                      )}
                    </small>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={d.regulation.charger}
                      onChange={(e) =>
                        update("regulation", "charger", e.target.checked)
                      }
                    />
                    {bi(
                      "具备适配所选储能的充电管理",
                      "Charging path compatible with the selected storage",
                    )}
                  </label>
                </div>
              </section>
              <aside className="panel results">
                <h2>03 · {tr("results")}</h2>
                <div className={"status " + (result?.status ?? "incomplete")}>
                  <Warning />
                  {result ? tr(result.status) : tr("incomplete")}
                </div>
                <div className="hero-metric">
                  <span>{tr("runtime")}</span>
                  <strong>{runtime(result)}</strong>
                  <small>
                    {bi(
                      "从周一开灯时刻开始",
                      "Starting when lights turn on Monday",
                    )}
                  </small>
                </div>
                {result?.batteryEstimateHours != null && (
                  <div className="mini-result">
                    <span>
                      {bi("标称容量估算续航", "Nominal-capacity estimate")}
                    </span>
                    <strong>
                      {fmt(result.batteryEstimateHours / 24, 1)}{" "}
                      <small>d</small>
                    </strong>
                  </div>
                )}
                <div className="metrics">
                  <div>
                    {tr("dark")}
                    <b>{runtime(result, true)}</b>
                  </div>
                  <div>
                    {tr("average")}
                    <b>{fmt(result?.averageUa ?? 0)} µA</b>
                  </div>
                  <div>
                    {tr("peak")}
                    <b>{fmt(result?.peakUa ?? 0)} µA</b>
                  </div>
                  <div>
                    {bi("最长连续暗期", "Longest dark interval")}
                    <b>{result?.longestDarkHours} h</b>
                  </div>
                </div>
                <div className="display-preview">
                  <img
                    src={
                      d.device === "MHO-C404"
                        ? "/assets/MHO-C404-body-white.png"
                        : "/assets/MOT-U125-body-white.png"
                    }
                    alt={d.device}
                  />
                  <p>
                    {d.device === "MHO-C404"
                      ? bi(
                          "电子墨水屏断电后可保留画面；刷新耗能参数待补充。",
                          "E-paper can retain an image without power. Refresh energy is unconfirmed.",
                        )
                      : d.load.voltage < 1.2
                        ? bi(
                            "LCD：低于 1.2V，显示不可见（测试记录）。",
                            "LCD below 1.2 V: invisible (test observation).",
                          )
                        : d.load.voltage > 1.8
                          ? bi(
                              "LCD：高于 1.8V，鬼影严重（测试记录）。",
                              "LCD above 1.8 V: severe ghosting (test observation).",
                            )
                          : bi(
                              "LCD 外观示意；驱动波形与对比度仍需实测。",
                              "LCD appearance only; waveform and contrast need measurement.",
                            )}
                  </p>
                </div>
                {chart(result)}
                {!valid.success && (
                  <p className="warning">
                    {valid.error.issues
                      .map((i) => `${i.path.join(".")}: ${i.message}`)
                      .join("; ")}
                  </p>
                )}
                <div className="findings">
                  {[...(result?.missing ?? []), ...(result?.errors ?? [])].map(
                    (v) => (
                      <p key={v} className="warning">
                        {explain(locale, v)}
                      </p>
                    ),
                  )}
                  {result?.warnings.map((v) => (
                    <p key={v}>{explain(locale, v)}</p>
                  ))}
                </div>
                {number(
                  tr("horizon"),
                  d.horizonDays,
                  (v) => setD({ ...d, horizonDays: v ?? 1 }),
                  30,
                )}
                {number(
                  tr("margin"),
                  d.margin,
                  (v) => setD({ ...d, margin: v ?? 0 }),
                  20,
                )}
                <button onClick={exportJson}>
                  <Download /> JSON
                </button>
                {current && (
                  <>
                    <button
                      onClick={() => {
                        setTarget({ type: "case", target: current.id });
                        setPage("forum");
                      }}
                    >
                      <Chats />
                      {tr("forum")}
                    </button>
                    {revisions.map((r) => (
                      <div className="revision-row" key={r.id}>
                        <button
                          onClick={() => {
                            setD(r.design);
                            setCurrent({ ...current, parent: r.id });
                          }}
                        >
                          v{r.number} · {date(r.created_at)}
                        </button>
                        <button
                          aria-label={`${tr("forum")} v${r.number}`}
                          onClick={() => {
                            setTarget({ type: "revision", target: r.id });
                            setPage("forum");
                          }}
                        >
                          <Chats />
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </aside>
            </div>
          </>
        )}
        {page === "compare" && (
          <>
            <div className="panel compare-conditions">
              <label className="check">
                <input
                  type="checkbox"
                  checked={lockConditions}
                  onChange={(e) => setLockConditions(e.target.checked)}
                />
                {bi(
                  "锁定共同条件：设备负载、光照、仿真时长",
                  "Lock common conditions: load, lighting and simulation horizon",
                )}
              </label>
              <span>
                {fmt(result?.averageUa ?? 0)} µA · {d.load.voltage} V ·{" "}
                {d.light.lux} lux · {d.light.days} × {d.light.hours} h
              </span>
            </div>
            <div className="compare-grid">
              {[...snapshots, d]
                .map((item) =>
                  lockConditions
                    ? {
                        ...item,
                        load: d.load,
                        light: d.light,
                        horizonDays: d.horizonDays,
                        device: d.device,
                      }
                    : item,
                )
                .map((design, i) => {
                  let r: Result | null = null;
                  try {
                    r = calculate(design);
                  } catch {}
                  return (
                    <article className="panel compare-card" key={i}>
                      <div className="eyebrow">
                        {i === snapshots.length
                          ? bi("当前设计 · 实时", "CURRENT · LIVE")
                          : `SNAPSHOT ${i + 1}`}
                      </div>
                      <h2>{design.name}</h2>
                      <span className="badge">{tr(design.mode)}</span>
                      <div className="compare-path">
                        {design.mode === "battery" ? (
                          <Battery size={32} />
                        ) : (
                          <Sun size={32} />
                        )}
                        <ArrowRight />
                        <span>{design.path.toUpperCase()}</span>
                        {design.mode === "hybrid" && (
                          <>
                            <ArrowRight />
                            <Battery size={24} />
                            <span>{design.storage.farads ?? "—"} F</span>
                          </>
                        )}
                        <ArrowRight />
                      </div>
                      <img
                        className="compare-product"
                        src={
                          design.device === "MHO-C404"
                            ? "/assets/MHO-C404-body-white.png"
                            : "/assets/MOT-U125-body-white.png"
                        }
                        alt={design.device}
                      />
                      <div className="hero-metric">
                        <span>{tr("runtime")}</span>
                        <strong>
                          {!r || r.status !== "conditional"
                            ? "—"
                            : r.runtimeHours === null
                              ? `≥ ${design.horizonDays * 24} h`
                              : `${fmt(r.runtimeHours)} h`}
                        </strong>
                      </div>
                      <dl>
                        {r?.batteryEstimateHours != null && (
                          <>
                            <dt>
                              {bi(
                                "标称容量估算续航",
                                "Nominal-capacity estimate",
                              )}
                            </dt>
                            <dd>{fmt(r.batteryEstimateHours / 24, 1)} d</dd>
                          </>
                        )}
                        <dt>{tr("average")}</dt>
                        <dd>{fmt(r?.averageUa ?? 0)} µA</dd>
                        <dt>{tr("area")}</dt>
                        <dd>{design.pv.areaCm2}</dd>
                        <dt>{tr("storage")}</dt>
                        <dd>
                          {design.mode === "pv"
                            ? "—"
                            : design.storage.componentId}
                        </dd>
                        <dt>{tr("regulation")}</dt>
                        <dd>{design.path.toUpperCase()}</dd>
                        <dt>{tr("lux")}</dt>
                        <dd>{design.light.lux}</dd>
                      </dl>
                      <p className="warning">
                        {r ? tr(r.status) : tr("incomplete")}
                      </p>
                      {chart(r)}
                      {i < snapshots.length && (
                        <div className="toolbar">
                          <button
                            onClick={() => {
                              setD(cloneDesign(design));
                              setPage("workbench");
                            }}
                          >
                            {tr("workbench")}
                          </button>
                          <button
                            onClick={() =>
                              setSnapshots((s) => s.filter((_, j) => j !== i))
                            }
                          >
                            <Trash />
                            {tr("delete")}
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
            </div>
            <p className="caption">
              {bi(
                "快照保留各自光照与负载条件；比较前请核对这些条件一致。",
                "Snapshots retain their own lighting and loads. Check these conditions before comparing.",
              )}
            </p>
          </>
        )}
        {page === "hall" && (
          <>
            <div className="toolbar">
              {[
                "public",
                ...(viewer?.employee ? ["company", "private"] : []),
                "mine",
              ].map((s) => (
                <button
                  key={s}
                  className={hallScope === s ? "primary" : ""}
                  onClick={() => setHallScope(s)}
                >
                  {tr(s as Word)}
                </button>
              ))}
            </div>
            <div className="cards">
              {cases.map((c) => (
                <article className="panel" key={c.id}>
                  <span className="badge">
                    {c.official ? tr("official") : tr(c.scope)}
                  </span>
                  <h2>{c.name}</h2>
                  <p>
                    {human(c.author_name ?? "")} · v{c.latest_revision} ·{" "}
                    {date(c.updated_at)}
                  </p>
                  <div className="toolbar">
                    <button onClick={() => openCase(c.id)}>
                      {tr("workbench")}
                    </button>
                    <button onClick={() => openCase(c.id, true)}>
                      <Copy />
                      {tr("copy")}
                    </button>
                    {c.author_id && (
                      <button
                        onClick={() => {
                          setRecipient(c.author_id!);
                          setModal("messages");
                        }}
                      >
                        <Envelope />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
            {!cases.length && <p>{tr("empty")}</p>}
          </>
        )}
        {page === "library" && (
          <>
            <button
              disabled={!viewer}
              onClick={() => {
                setParams("{}");
                setModal("newcomponent");
              }}
            >
              <Plus />
              {bi("新增元器件", "New component")}
            </button>
            <input
              className="search"
              aria-label={tr("search")}
              placeholder={tr("search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <p>
              {bi(
                "数据包含厂家资料、待核验候选和自定义模板。采用前请检查测试条件。",
                "Includes manufacturer data, unverified candidates and custom templates. Check test conditions before adoption.",
              )}
            </p>
            <div className="cards">
              {components
                .filter((c) =>
                  (c.name + c.manufacturer + c.category)
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((c) => (
                  <article className="panel component-card" key={c.id}>
                    <div className="section-title">
                      <span className="badge">{c.category.toUpperCase()}</span>
                      {c.verified ? (
                        <CheckCircle color="#258164" />
                      ) : (
                        <Warning color="#9a6500" />
                      )}
                    </div>
                    <h2>{c.name}</h2>
                    <p>{c.manufacturer}</p>
                    <p>{c.description}</p>
                    <div className="toolbar">
                      <button onClick={() => showComponent(c)}>
                        {tr("details")}
                      </button>
                      <button onClick={() => useComponent(c)}>
                        {bi("用于设计", "Use in design")}
                      </button>
                    </div>
                  </article>
                ))}
            </div>
          </>
        )}
        {page === "forum" && (
          <div className="panel forum">
            <div className="section-title">
              <h2>
                {tr("forum")} · {target.type} / {target.target}
              </h2>
              <button
                onClick={() =>
                  setTarget({ type: "application", target: "general" })
                }
              >
                {bi("全部应用", "General")}
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api("/posts", { ...target, body: postBody });
                  setPostBody("");
                  setPosts(
                    (
                      await api(
                        `/posts?type=${target.type}&target=${target.target}`,
                      )
                    ).posts,
                  );
                });
              }}
            >
              <textarea
                placeholder={
                  viewer
                    ? bi(
                        "分享测试条件、结果或问题…",
                        "Share test conditions, results or questions…",
                      )
                    : tr("login")
                }
                value={postBody}
                onChange={(e) => setPostBody(e.target.value)}
              />
              <button
                className="primary"
                disabled={!viewer || busy || !postBody.trim()}
              >
                {tr("send")}
              </button>
            </form>
            {posts.map((p) => (
              <article className="post" key={p.id}>
                <button
                  onClick={() => {
                    setRecipient(p.author_id);
                    setModal("messages");
                  }}
                >
                  {human(p.author_name)}{" "}
                  <span className="badge">
                    Lv{1 + Math.floor(p.posts_count / 100)}
                  </span>
                </button>
                <small>{date(p.created_at)}</small>
                <p>{p.body}</p>
                {(viewer?.admin || viewer?.id === p.author_id) && (
                  <button
                    onClick={() =>
                      run(async () => {
                        await api("/posts/" + p.id, undefined, "DELETE");
                        setPosts(posts.filter((x) => x.id !== p.id));
                      })
                    }
                  >
                    {tr("delete")}
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
        {page === "admin" && viewer?.admin && admin && (
          <div className="admin-grid">
            <AIAdmin locale={locale} />
            <section className="panel">
              <h2>{bi("用户与访问权限", "Users & access")}</h2>
              {admin.users.map((u: any) => (
                <div className="admin-row" key={u.id}>
                  <span>
                    {u.email}
                    <small>{date(u.created_at)}</small>
                  </span>
                  <button
                    disabled={u.id === viewer.id}
                    onClick={() =>
                      run(async () => {
                        await api(
                          "/admin/users/" + u.id,
                          { active: !u.active },
                          "PATCH",
                        );
                        setAdmin(await api("/admin"));
                      })
                    }
                  >
                    {u.active ? bi("停用", "Disable") : bi("启用", "Enable")}
                  </button>
                </div>
              ))}
            </section>
            <section className="panel">
              <h2>{tr("review")}</h2>
              {admin.specs.map((s: any) => (
                <div className="admin-row" key={s.id}>
                  <span>
                    {s.component_name}
                    <small>
                      {s.filename} · {s.status}
                    </small>
                  </span>
                  <button
                    onClick={() => {
                      const c = components.find((c) => c.id === s.component_id);
                      if (c) showComponent(c);
                    }}
                  >
                    {tr("review")}
                  </button>
                </div>
              ))}
            </section>
            <section className="panel">
              <h2>{bi("邮件投递队列", "Email queue")}</h2>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api("/admin/maintenance", {});
                    setAdmin(await api("/admin"));
                  })
                }
              >
                {bi(
                  "重试失败邮件 / 清理过期记录",
                  "Retry failed mail / clean expired records",
                )}
              </button>
              {admin.mail.map((m: any) => (
                <p key={m.id}>
                  {m.state} · {m.attempts} · {m.error_code ?? ""}
                </p>
              ))}
            </section>
            <section className="panel">
              <h2>{bi("审计记录", "Audit log")}</h2>
              {admin.audit.map((a: any) => (
                <p key={a.id}>
                  {date(a.created_at)} · {a.action} · {a.target_id}
                </p>
              ))}
            </section>
          </div>
        )}
      </main>
      <footer>
        <img src="/assets/zenmeasure-gray.png" alt="ZenMeasure" />
        <span>PowerMatch · Open source · Engine 0.1.0</span>
        <a
          href="https://github.com/liangyuyang/PowerMatch"
          target="_blank"
          rel="noreferrer"
        >
          GitHub ↗
        </a>
      </footer>
      <AIAssistant
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        Dialog={ModalShell}
        design={d}
        locale={locale}
        viewer={viewer}
        onLogin={() => {
          setAiOpen(false);
          setModal("login");
        }}
        onApply={(base, next) => {
          if (JSON.stringify(d) !== JSON.stringify(base)) {
            setNotice(
              bi(
                "设计已改变，请重新生成建议。",
                "Design changed; request a new proposal.",
              ),
            );
            return;
          }
          setUndoAI({ before: cloneDesign(d), after: cloneDesign(next) });
          setD(cloneDesign(next));
        }}
        onCompare={(next) => {
          setSnapshots((s) => [...s.slice(-2), cloneDesign(next)]);
          setPage("compare");
        }}
      />
      {picker && (
        <ModalShell
          title={bi("选择元器件", "Choose a component")}
          onClose={() => setPicker(null)}
        >
          {picker === "device" ? (
            <>
              <p>
                {bi(
                  "Tiny 有耗电时序；MHO-C404 尚缺实测耗电数据。",
                  "Tiny has a load profile; MHO-C404 still needs measured power data.",
                )}
              </p>
              <button
                onClick={() => {
                  setD({ ...d, device: "MOT-U125", load: cloneDesign().load });
                  setPicker(null);
                }}
              >
                穿山甲 Tiny · MOT-U125
              </button>
              <button
                onClick={() => {
                  setD({
                    ...d,
                    device: "MHO-C404",
                    load: {
                      voltage: 3,
                      minVoltage: 2,
                      maxVoltage: 3.3,
                      phases: [
                        { name: "Unconfirmed", seconds: 1, currentUa: 0 },
                      ],
                    },
                  });
                  setPicker(null);
                }}
              >
                MHO-C404 · {bi("资料待补全", "Incomplete data")}
              </button>
            </>
          ) : (
            <>
              <input
                aria-label={bi("搜索元器件", "Search components")}
                placeholder={bi(
                  "搜索型号、厂商、OPV、a-Si…",
                  "Search model, maker, OPV, a-Si…",
                )}
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
              />
              <p>
                {bi(
                  "选择型号自动填入库内参数；缺失数据保留待补全，效率等现有假设仍需检查。供电方式保持不变。",
                  "Selecting a model fills catalog parameters. Missing data stays unknown; retained efficiency assumptions need review. Supply mode is preserved.",
                )}
              </p>
              <div className="ai-model-list">
                {components
                  .filter(
                    (c) =>
                      (picker === "pv"
                        ? c.category === "pv"
                        : picker === "regulation"
                          ? ["ldo", "pmic"].includes(c.category)
                          : [
                              "battery",
                              "lic",
                              "supercap",
                              "supercapacitor",
                              "rechargeable",
                            ].includes(c.category)) &&
                      JSON.stringify([c.name, c.manufacturer, c.parameters])
                        .toLowerCase()
                        .includes(pickerSearch.toLowerCase()),
                  )
                  .map((c) => (
                    <button
                      className="ai-model"
                      key={c.id}
                      onClick={() => {
                        try {
                          setD(selectComponent(d, c));
                          setPicker(null);
                        } catch (e) {
                          setNotice(String(e));
                        }
                      }}
                    >
                      <b>{c.name}</b>
                      <span>
                        {c.manufacturer} · {c.category}
                      </span>
                      <small>{c.description}</small>
                    </button>
                  ))}
              </div>
            </>
          )}
        </ModalShell>
      )}
      {modal && (
        <ModalShell
          title={tr(
            modal === "newcomponent"
              ? "add"
              : modal === "component"
                ? "details"
                : modal === "delete"
                  ? "delete"
                  : modal === "messages"
                    ? "messages"
                    : modal,
          )}
          onClose={() => setModal(null)}
        >
          {modal === "login" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  if (loginToken) {
                    const x = await api("/auth/consume", { token: loginToken });
                    setViewer(x.user);
                    setLoginToken(null);
                    setModal(null);
                  } else {
                    await api("/auth/request", { email, locale });
                    setNotice(tr("emailSent"));
                    setModal(null);
                  }
                });
              }}
            >
              <p>
                {bi(
                  "秒秒测企业邮箱可保存个人方案、公司分享；其他用户保存至公开大厅。",
                  "ZenMeasure accounts can save private and company cases. Other users save to the public hall.",
                )}
              </p>
              {!loginToken && (
                <input
                  aria-label="Email"
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              )}
              {!emailReady && !loginToken && (
                <p className="warning">
                  {bi(
                    "邮件服务尚未配置完成。",
                    "Email service configuration is pending.",
                  )}
                </p>
              )}
              <button
                className="primary"
                disabled={busy || (!emailReady && !loginToken)}
              >
                {loginToken ? tr("login") : tr("send")}
              </button>
            </form>
          )}
          {modal === "newcomponent" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api("/components", {
                    name: partName,
                    manufacturer: partMaker,
                    category: partCategory,
                    source: partSource,
                    description: "Community contribution; requires review.",
                    parameters: JSON.parse(params),
                  });
                  setComponents((await api("/components")).components);
                  setModal(null);
                });
              }}
            >
              <label className="field">
                <span>{tr("name")}</span>
                <input
                  required
                  value={partName}
                  onChange={(e) => setPartName(e.target.value)}
                />
              </label>
              <label className="field">
                <span>{bi("厂家", "Manufacturer")}</span>
                <input
                  value={partMaker}
                  onChange={(e) => setPartMaker(e.target.value)}
                />
              </label>
              {select(
                bi("类别", "Category"),
                partCategory,
                [
                  "battery",
                  "lic",
                  "supercap",
                  "pv",
                  "ldo",
                  "pmic",
                  "display",
                  "passive",
                ].map((s) => [s, s]),
                setPartCategory,
              )}
              <label className="field">
                <span>Source URL</span>
                <input
                  type="url"
                  value={partSource}
                  onChange={(e) => setPartSource(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Parameters JSON</span>
                <textarea
                  value={params}
                  onChange={(e) => setParams(e.target.value)}
                />
              </label>
              <button disabled={busy} className="primary">
                {tr("save")}
              </button>
            </form>
          )}
          {modal === "save" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const x = await api("/cases", {
                    ...(current?.canEdit
                      ? { id: current.id, expectedRevision: current.revision }
                      : {}),
                    name: d.name,
                    design: d,
                    scope,
                    parentRevision: current?.parent ?? null,
                  });
                  setCurrent({
                    id: x.id,
                    revision: x.number,
                    parent: x.revisionId,
                    canEdit: true,
                  });
                  setNotice(tr("saved"));
                  setModal(null);
                  setRevisions((await api("/cases/" + x.id)).revisions);
                });
              }}
            >
              <label className="field">
                <span>{tr("name")}</span>
                <input
                  value={d.name}
                  onChange={(e) => setD({ ...d, name: e.target.value })}
                  required
                />
              </label>
              {select(
                bi("保存到", "Visibility"),
                scope,
                (
                  [
                    "public",
                    ...(viewer?.employee ? ["company", "private"] : []),
                  ] as Scope[]
                ).map((s) => [s, tr(s)]),
                (v) => setScope(v as Scope),
              )}
              <p className="warning">
                {scope === "public"
                  ? bi(
                      "保存后任何访客都可查看和复制此版本，请勿包含保密资料。",
                      "Anyone can read and copy this revision. Do not include confidential information.",
                    )
                  : bi(
                      "仅有权限的用户可以查看。",
                      "Visible only to authorized users.",
                    )}
              </p>
              <button className="primary" disabled={busy || !valid.success}>
                {tr("save")}
              </button>
              {current?.canEdit && (
                <button type="button" onClick={() => setModal("delete")}>
                  {tr("delete")}
                </button>
              )}
            </form>
          )}
          {modal === "delete" && (
            <>
              <p>
                {bi(
                  "删除整个方案？已有输入仍保留在当前工作台。",
                  "Delete this case? Current workbench inputs will remain.",
                )}
              </p>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (current)
                      await api("/cases/" + current.id, undefined, "DELETE");
                    setCurrent(null);
                    setModal(null);
                  })
                }
              >
                {tr("delete")}
              </button>
            </>
          )}
          {modal === "component" && selected && (
            <>
              <h3>
                {selected.manufacturer} · {selected.name}
              </h3>
              <p>{selected.description}</p>
              {selected.source && (
                <a href={selected.source} target="_blank" rel="noreferrer">
                  {bi("来源 / 厂家规格书", "Source / manufacturer datasheet")} ↗
                </a>
              )}
              <pre>{JSON.stringify(selected.parameters, null, 2)}</pre>
              <button
                onClick={() => {
                  setTarget({ type: "component", target: selected.id });
                  setPage("forum");
                  setModal(null);
                }}
              >
                {tr("forum")}
              </button>
              <h3>{tr("upload")}</h3>
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              />
              <button
                disabled={!viewer || !uploadFile || busy}
                onClick={() =>
                  run(async () => {
                    const form = new FormData();
                    form.set("file", uploadFile!);
                    const x = await api("/specs/extract", form);
                    setCandidates(x.candidates);
                    if (x.ocrRequired)
                      setNotice(
                        bi(
                          "扫描件需要 OCR；请暂时人工填写。",
                          "Scanned document needs OCR; enter parameters manually.",
                        ),
                      );
                  })
                }
              >
                {bi("提取 PDF 候选参数", "Extract PDF candidates")}
              </button>
              {candidates.map((c, i) => (
                <div className="post" key={i}>
                  <p>
                    {c.parameter}: {c.value}
                  </p>
                  <small>{c.excerpt}</small>
                  <button
                    onClick={() => {
                      try {
                        setParams(
                          JSON.stringify(
                            { ...JSON.parse(params), [c.parameter]: c.value },
                            null,
                            2,
                          ),
                        );
                      } catch {
                        setNotice("Invalid JSON");
                      }
                    }}
                  >
                    {bi("填入候选值", "Use candidate")}
                  </button>
                </div>
              ))}
              <label className="field">
                <span>
                  {bi(
                    "候选参数 JSON（需审核）",
                    "Candidate parameters JSON (review required)",
                  )}
                </span>
                <textarea
                  value={params}
                  onChange={(e) => setParams(e.target.value)}
                />
              </label>
              <button
                disabled={!viewer || !uploadFile || busy}
                onClick={() =>
                  run(async () => {
                    const f = new FormData();
                    f.set("file", uploadFile!);
                    f.set("parameters", JSON.stringify(JSON.parse(params)));
                    await api("/components/" + selected.id + "/specs", f);
                    setSpecs(
                      (await api("/components/" + selected.id + "/specs"))
                        .specs,
                    );
                    setNotice(bi("已提交审核", "Submitted for review"));
                  })
                }
              >
                {tr("upload")}
              </button>
              {specs.map((s) => (
                <article className="post" key={s.id}>
                  <a href={"/api/specs/" + s.id + "/file"}>{s.filename}</a>
                  <p>
                    {human(s.author_name)} · {s.status} · {date(s.created_at)}
                  </p>
                  <small>SHA-256 {s.sha256}</small>
                  {viewer?.employee && (
                    <>
                      <button onClick={() => setParams(s.proposed_json)}>
                        {tr("review")}
                      </button>
                      <input
                        placeholder={bi("审核说明", "Review note")}
                        value={reviewNote}
                        onChange={(e) => setReviewNote(e.target.value)}
                      />
                      <button
                        disabled={!reviewNote || busy}
                        onClick={() =>
                          run(async () => {
                            await api("/specs/" + s.id + "/review", {
                              action: "adopt",
                              note: reviewNote,
                              parameters: JSON.parse(params),
                            });
                            setComponents(
                              (await api("/components")).components,
                            );
                            setSpecs(
                              (
                                await api(
                                  "/components/" + selected.id + "/specs",
                                )
                              ).specs,
                            );
                          })
                        }
                      >
                        {bi("采用此规格版本", "Adopt this spec revision")}
                      </button>
                    </>
                  )}
                </article>
              ))}
            </>
          )}
          {modal === "messages" && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    await api("/messages", {
                      recipientId: recipient,
                      body: messageBody,
                    });
                    setMessageBody("");
                    setNotice(
                      bi(
                        "留言已保存，邮件通知已排队。",
                        "Message saved; email notification queued.",
                      ),
                    );
                    setMessages((await api("/messages")).messages);
                  });
                }}
              >
                {recipient && (
                  <>
                    <textarea
                      aria-label={tr("messages")}
                      value={messageBody}
                      onChange={(e) => setMessageBody(e.target.value)}
                    />
                    <button
                      disabled={!viewer || busy || !messageBody.trim()}
                      className="primary"
                    >
                      {tr("send")}
                    </button>
                  </>
                )}
                {!viewer && <p>{tr("login")}</p>}
              </form>
              {messages.map((m) => (
                <article className="post" key={m.id}>
                  <button
                    onClick={() =>
                      setRecipient(
                        m.sender_id === viewer?.id
                          ? m.recipient_id
                          : m.sender_id,
                      )
                    }
                  >
                    {human(m.sender_name)} → {human(m.recipient_name)}
                  </button>
                  <small>{date(m.created_at)}</small>
                  <p>{m.body}</p>
                </article>
              ))}
            </>
          )}
        </ModalShell>
      )}
      {report && (
        <article className="print-report">
          <img
            className="report-logo"
            src="/assets/zenmeasure-blue.png"
            alt="ZenMeasure"
          />
          <h1>PowerMatch · {d.name}</h1>
          <p>
            {new Date().toISOString().slice(0, 10)} · Engine 0.1.0 · {tr(scope)}
          </p>
          <h2>{tr("results")}</h2>
          <p>
            {tr("runtime")}: {runtime(result)} · {tr("dark")}:{" "}
            {runtime(result, true)} · {tr("average")}:{" "}
            {fmt(result?.averageUa ?? 0)} µA
          </p>
          {flow}
          {result?.batteryEstimateHours != null && (
            <p>
              {bi("标称容量估算续航", "Nominal-capacity estimate")}:{" "}
              {fmt(result.batteryEstimateHours / 24, 1)} d
            </p>
          )}
          <h2>{tr("device")}</h2>
          <table>
            <thead>
              <tr>
                <th>{tr("phase")}</th>
                <th>{tr("seconds")}</th>
                <th>{tr("current")}</th>
              </tr>
            </thead>
            <tbody>
              {d.load.phases.map((p, i) => (
                <tr key={i}>
                  <td>{p.name}</td>
                  <td>{p.seconds}</td>
                  <td>{p.currentUa}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2>{tr("notes")}</h2>
          <p>{d.notes}</p>
          {[
            ...(result?.missing ?? []),
            ...(result?.errors ?? []),
            ...(result?.warnings ?? []),
          ].map((v) => (
            <p key={v}>{explain(locale, v)}</p>
          ))}
          <h2>{bi("元器件来源", "Component sources")}</h2>
          {components
            .filter((c) =>
              [
                d.storage.componentId,
                d.pv.componentId,
                d.regulation.componentId,
              ].includes(c.id),
            )
            .map((c) => (
              <p key={c.id}>
                {c.manufacturer} · {c.name}
                <br />
                <a href={c.source}>{c.source}</a>
              </p>
            ))}
          <h2>{bi("可复核输入参数", "Reproducible inputs")}</h2>
          <pre>{JSON.stringify(d, null, 2)}</pre>
          <p>ZenMeasure · https://powermatch.zenmeasure.space</p>
        </article>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

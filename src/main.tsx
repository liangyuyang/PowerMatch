import React, { useEffect, useRef, useState } from "react";
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
  cloneDesign,
  DEFAULT_DESIGN,
  chooseLocale,
  locales,
  changeStorage,
  changeMode,
  designSchema,
  type Design,
  type Viewer,
  type Scope,
  type Component,
  type Locale,
} from "./shared/model";
import { calculate, ENGINE_VERSION, type Result } from "./shared/engine";
import { CATALOG } from "./shared/catalog";
import { t, explain, languageNames, type Word } from "./i18n";
import "./style.css";
const AIAssistant = React.lazy(() => import("./ai-ui").then((module) => ({ default: module.AIAssistant })));
const AIAdmin = React.lazy(() => import("./model-settings").then((module) => ({ default: module.AIAdmin })));
const EnergyChart = React.lazy(() => import("./energy-chart"));
import { canUseComponent, selectComponent } from "./shared/assistant";
import { draftKey, readDraft, writeDraft } from "./shared/draft";
import { ComponentHover } from "./component-hover";
import { NumericInput } from "./numeric-input";

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
const currentText = (ua: number | null | undefined) =>
  ua == null ? "—" : Math.abs(ua) < 1 && ua !== 0 ? `${fmt(ua * 1000)} nA` : `${fmt(ua)} µA`;
const calculationKey = (d: Design) => JSON.stringify({
  device: d.device, load: d.load, mode: d.mode, path: d.path,
  light: d.light, pv: d.pv, storage: d.storage, regulation: d.regulation,
  horizonDays: d.horizonDays, margin: d.margin,
});
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
function starterSnapshots(): Design[] {
  const battery = changeMode(cloneDesign(), "battery");
  battery.name = "CR2032 · Battery";
  const lic = changeMode(cloneDesign(), "hybrid");
  lic.name = "PV + LIC 1F";
  return [battery, lic];
}
class AppRecovery extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="recovery panel" role="alert">
      <h1>PowerMatch</h1>
      <p>页面遇到错误。已保存的本机草稿可在重新打开后恢复。 / The page encountered an error. Your local draft can be restored after reopening.</p>
      <button className="primary" onClick={() => location.reload()}>重新打开 / Reopen</button>
    </main>;
    return this.props.children;
  }
}
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
      if (trigger?.isConnected) trigger.focus();
      else document.querySelector<HTMLElement>("nav button.active")?.focus();
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
  const [aiLoaded, setAiLoaded] = useState(false);
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
      return starterSnapshots();
    }),
    [lockConditions, setLockConditions] = useState(true),
    [sessionReady, setSessionReady] = useState(false),
    [draftOwner, setDraftOwner] = useState<string | null>(null),
    [undoPreset, setUndoPreset] = useState<Design | null>(null),
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
    [reportCompare, setReportCompare] = useState(false),
    [partName, setPartName] = useState(""),
    [partMaker, setPartMaker] = useState(""),
    [partCategory, setPartCategory] = useState("battery"),
    [partSource, setPartSource] = useState("");
  const resultCache = useRef(new Map<string, Result | null>());
  const calculateCached = (design: Design) => {
    const key = calculationKey(design);
    if (resultCache.current.has(key)) return resultCache.current.get(key)!;
    let value: Result | null = null;
    try { value = calculate(design); } catch { /* invalid draft is shown by validation */ }
    resultCache.current.set(key, value);
    if (resultCache.current.size > 24)
      resultCache.current.delete(resultCache.current.keys().next().value!);
    return value;
  };
  const valid = designSchema.safeParse(d);
  const result = calculateCached(d);
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
      )
      .finally(() => setSessionReady(true));
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
    if (!sessionReady) return;
    const owner = viewer?.id ?? "guest";
    let saved = null;
    try {
      saved = readDraft((owner === "guest" ? localStorage : sessionStorage).getItem(draftKey(owner)), owner);
    } catch { /* storage may be disabled */ }
    if (saved) {
      setD(saved.design);
      setSnapshots(saved.snapshots);
      setLockConditions(saved.lockConditions);
      setCurrent(null);
      setUndoPreset(null);
    } else if (draftOwner !== null && !viewer) {
      setD(cloneDesign());
      setSnapshots(starterSnapshots());
      setCurrent(null);
      setUndoPreset(null);
    }
    setDraftOwner(owner);
  }, [sessionReady, viewer?.id]);
  useEffect(() => {
    if (!draftOwner) return;
    try {
      (draftOwner === "guest" ? localStorage : sessionStorage).setItem(draftKey(draftOwner), writeDraft(draftOwner, {
        design: d, snapshots, lockConditions,
      }));
    } catch {
      // Browser storage may be unavailable; server-side case saving still works.
    }
  }, [draftOwner, d, snapshots, lockConditions]);
  useEffect(() => {
    if (!sessionReady || !viewer || new URLSearchParams(location.search).get("messages") !== "1") return;
    const url = new URL(location.href);
    url.searchParams.delete("messages");
    history.replaceState({}, "", url.pathname + url.search + url.hash);
    setModal("messages");
    void api("/messages")
      .then((x) => setMessages(x.messages))
      .catch((error) => setNotice(error instanceof Error ? error.message : String(error)));
  }, [sessionReady, viewer?.id]);
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
  const update = (group: keyof Design, key: string, value: unknown) => {
    setUndoPreset(null);
    setD((old) => ({
      ...old,
      [group]: { ...(old[group] as object), [key]: value },
      parameterSources: {
        ...old.parameterSources,
        [`${group}.${key}`]: { kind: "user" },
      },
    }));
  };
  const applyPreset = (next: Design) => {
    setUndoPreset(cloneDesign(d));
    setD(next);
  };
  const number = (
    label: string,
    value: number | null,
    onChange: (n: number | null) => void,
    base?: number | null,
    nullable = false,
    source?: NonNullable<Design["parameterSources"]>[string],
  ) => (
    <label
      className={
        "field " +
        (value === null
          ? "missing"
          : source?.kind === "user" || base !== undefined && value !== base && !source
            ? "modified"
            : "")
      }
    >
      <span>
        {label}
        <small>
          {value === null
            ? tr("pending")
            : source?.kind === "user" || base !== undefined && value !== base && !source
              ? tr("changed")
              : source?.kind === "catalog"
                ? bi("型号资料", "Catalog")
                : source?.kind === "assumption"
                  ? bi("演算假设", "Assumption")
                  : tr("default")}
        </small>
      </span>
      <NumericInput
        value={value}
        onChange={(raw) =>
          onChange(raw === "" ? (nullable ? null : 0) : Number(raw))
        }
      />
    </label>
  );
  const field = (
    group: "load" | "light" | "pv" | "storage" | "regulation",
    key: string,
    label: string,
    nullable = false,
  ) => {
    const raw = (d[group] as any)[key] as number | null;
    const base = (DEFAULT_DESIGN[group] as any)[key] as number | null;
    const nano = ((group === "regulation" && key === "iqUa") || (group === "storage" && key === "leakUa"))
      && raw !== null && Math.abs(raw) < 1;
    return number(
      nano ? label.replace("µA", "nA") : label,
      nano ? raw! * 1000 : raw,
      (v) => update(group, key, nano && v !== null ? v / 1000 : v),
      nano && base !== null ? base * 1000 : base,
      nullable,
      d.parameterSources?.[`${group}.${key}`],
    );
  };
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
  const conclusion = (design: Design, r: Result | null) => {
    if (!r || r.status !== "conditional") return bi("参数待补或电路不兼容，暂不能判断续航。", "Missing parameters or incompatible circuit; runtime cannot be concluded yet.");
    const observed = r.runtimeHours === null
      ? bi(`模拟 ${design.horizonDays} 天内未断电；更长期仍需验证。`, `No outage in the ${design.horizonDays}-day simulation; longer operation is unverified.`)
      : bi(`从周一开灯时刻起约 ${fmt(r.runtimeHours)} 小时首次断电。`, `First outage after about ${fmt(r.runtimeHours)} hours from Monday lights-on.`);
    if (design.mode === "pv")
      return bi(`纯光伏无储能，熄灯后不能持续供电。${observed}`, `Pure PV has no storage and cannot keep running after lights-off. ${observed}`);
    if (design.mode === "battery")
      return bi(`仅由电池供电。${observed}标称容量估算未包含真实放电曲线。`, `Battery-only supply. ${observed}The nominal-capacity estimate omits the actual discharge curve.`);
    const dark = r.darkHours ?? design.horizonDays * 24;
    const bridge = r.darkHours === null || dark >= r.longestDarkHours
      ? bi(`当前储能在模型中可覆盖最长约 ${fmt(r.longestDarkHours)} 小时暗期。`, `The modeled storage can cover the longest ${fmt(r.longestDarkHours)}-hour dark interval.`)
      : bi(`最长暗期约 ${fmt(r.longestDarkHours)} 小时，单靠当前储能约支撑 ${fmt(dark)} 小时，缺口约 ${fmt(r.longestDarkHours - dark)} 小时。`, `The longest dark interval is ${fmt(r.longestDarkHours)} hours; storage alone lasts about ${fmt(dark)} hours, a gap of ${fmt(r.longestDarkHours - dark)} hours.`);
    return `${bridge} ${observed}`;
  };
  const componentLabel = (id: string) =>
    components.find((part) => part.id === id)?.name ?? CATALOG.find((part) => part.id === id)?.name ?? id;
  const openCase = async (id: string, duplicate = false) =>
    run(async () => {
      const x = await api("/cases/" + id);
      setD(x.revisions[0].design);
      setUndoPreset(null);
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
  useEffect(() => {
    const openLinked = () => {
      if (!location.hash.startsWith("#component=")) return;
      let id: string;
      try {
        id = decodeURIComponent(location.hash.slice(11));
      } catch {
        return;
      }
      const c =
        components.find((c) => c.id === id) ?? CATALOG.find((c) => c.id === id);
      if (c) {
        setPage("library");
        void showComponent(c);
      }
    };
    openLinked();
    window.addEventListener("hashchange", openLinked);
    return () => window.removeEventListener("hashchange", openLinked);
  }, [components]);
  const useComponent = (c: Component) => {
    if (!canUseComponent(c)) {
      setNotice(bi("该条目仅供查看资料，暂不能放入供电路径。", "This entry is for reference and cannot be added to the energy path yet."));
      return;
    }
    try {
      const n = selectComponent(d, c);
      if (c.category === "pv") n.mode = "pv";
      if (c.category === "battery") {
        n.mode = "battery";
        n.regulation.charger = false;
      }
      if (["lic", "supercap", "rechargeable"].includes(c.category)) {
        const base = changeStorage({ ...n, mode: "hybrid" }, n.storage.kind);
        base.storage = n.storage;
        base.parameterSources = {
          ...base.parameterSources,
          ...Object.fromEntries(Object.entries(n.parameterSources ?? {}).filter(([key]) => key.startsWith("storage."))),
        };
        applyPreset(base);
      } else {
        applyPreset(n);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      return;
    }
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
    setReportCompare(page === "compare");
    setReport(true);
  };
  useEffect(() => {
    if (!report) return;
    let active = true;
    void (async () => {
      await document.fonts.ready;
      const logo = document.querySelector<HTMLImageElement>(".report-logo");
      if (logo) await logo.decode().catch(() => {});
      if (active) requestAnimationFrame(() => { if (active) window.print(); });
    })();
    return () => { active = false; };
  }, [report]);
  const chart = (r: Result | null, mode: Design["mode"]) => (
    <div className="chart">
      {r?.trace.length ? (
        <React.Suspense fallback={<p className="caption">{bi("正在绘制曲线…", "Drawing chart…")}</p>}>
          <EnergyChart result={r} mode={mode} locale={locale} />
        </React.Suspense>
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
  const componentInfo = (
    kind: "pv" | "storage" | "regulation" | "device",
    child: React.ReactNode,
  ) => {
    const id =
      kind === "device"
        ? d.device === "MHO-C404"
          ? "mho-eink"
          : "tiny-lcd"
        : d[kind].componentId;
    const c = components.find((c) => c.id === id) ??
      CATALOG.find((c) => c.id === id) ?? {
        id,
        name: id,
        category: kind,
        manufacturer: "PowerMatch",
        official: false,
        verified: false,
        source: "",
        description: "当前设计配置 / Current design configuration",
        parameters: {},
      };
    const summary =
      kind === "pv"
        ? `${fmt(d.pv.areaCm2)} cm² · ${d.pv.voltage === null ? "—" : fmt(d.pv.voltage)} V · ${d.pv.densityUwCm2 === null ? "—" : fmt(d.pv.densityUwCm2)} µW/cm² @ ${fmt(d.pv.referenceLux)} lux`
        : kind === "storage"
          ? `${d.storage.series}S${d.storage.parallel}P · ${["lic", "supercap"].includes(d.storage.kind) ? `${fmt(d.storage.farads ?? 0)} F` : `${fmt(d.storage.capacityMah ?? 0)} mAh`} · ${fmt(d.storage.minVoltage ?? 0)}–${fmt(d.storage.maxVoltage ?? 0)} V`
          : kind === "regulation"
            ? `${d.path.toUpperCase()} · MPPT ${d.regulation.mppt ? "✓" : "—"} · ${fmt((d.regulation.iqUa ?? 0) * 1000)} nA`
            : `${d.device} · ${fmt(d.load.voltage)} V · ${fmt(result?.averageUa ?? 0)} µA`;
    return (
      <ComponentHover
        component={c}
        summary={summary}
        onDetails={(c) => {
          history.replaceState(
            null,
            "",
            `#component=${encodeURIComponent(c.id)}`,
          );
          setPage("library");
          void showComponent(c);
        }}
      >
        {child}
      </ComponentHover>
    );
  };
  const flow = (
    <div className="energy-flow">
      {componentInfo(
        d.mode === "battery" ? "storage" : "pv",
        <button
          className="component-node"
          onClick={() => setPicker(d.mode === "battery" ? "storage" : "pv")}
        >
          <Sun size={28} />
          <span>{d.mode === "battery" ? tr("battery") : tr("pv")}</span>
          {d.mode !== "battery" && (
            <img src="/assets/indoor-pv-display.webp" alt="Generic indoor PV" loading="lazy" />
          )}
        </button>,
      )}
      <ArrowRight className="flow-arrow" />
      {componentInfo(
        "regulation",
        <button
          className="component-node"
          onClick={() => setPicker("regulation")}
        >
          <Lightning size={28} />
          <span>{d.path.toUpperCase()}</span>
          <small>{d.regulation.mppt ? "MPPT ✓" : "MPPT —"}</small>
        </button>,
      )}
      {d.mode !== "pv" && (
        <>
          <ArrowRight className="flow-arrow" />
          {componentInfo(
            "storage",
            <button
              className="component-node"
              onClick={() => setPicker("storage")}
            >
              <Battery size={28} />
              <span>{d.storage.componentId}</span>
              <small>
                {d.storage.series}S{d.storage.parallel}P
              </small>
            </button>,
          )}
        </>
      )}
      <ArrowRight className="flow-arrow" />
      {componentInfo(
        "device",
        <button className="component-node" onClick={() => setPicker("device")}>
          <img
            src={
              d.device === "MHO-C404"
                ? "/assets/MHO-C404-body-white-display.webp"
                : "/assets/MOT-U125-body-proportional-display.webp"
            }
            alt={d.device}
          />
          <span>{d.device}</span>
          <small>{d.load.voltage} V</small>
        </button>,
      )}
    </div>
  );
  return (
    <>
      <header>
        <a href="/" className="brand">
          <img src="/assets/zenmeasure-blue.png" alt="ZenMeasure" />
          <span>
            PowerMatch
            <small>
              ENERGY DESIGN STUDIO{" "}
              <span className="app-version" title={`Git ${__APP_REVISION__}`}>
                {__APP_VERSION__} · {__APP_DATE__}
              </span>
            </small>
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
                    try { sessionStorage.removeItem(draftKey(viewer.id)); } catch { /* storage may be disabled */ }
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
              <button className="ai-launch" onClick={() => { setAiLoaded(true); setAiOpen(true); }}>
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
              {undoPreset && (
                <button onClick={() => { setD(undoPreset); setUndoPreset(null); }}>
                  {bi("撤销上次方案切换", "Undo last preset change")}
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
            <p className="caption">
              {viewer
                ? bi("未保存的草稿在当前浏览器会话中自动恢复；退出登录后清除。要跨设备使用，请保存方案。", "Unsaved drafts recover in this browser session and clear on sign-out. Save the case for use across devices.")
                : bi("访客草稿保存在本浏览器；清除浏览器数据会移除它。", "Guest drafts stay in this browser and disappear if its data is cleared.")}
            </p>
            <div className="mobile-summary panel">
              <div><strong>{result ? tr(result.status) : tr("incomplete")}</strong><span>{conclusion(d, result)}</span></div>
              <a href="#supply-inputs">{bi("调整方案", "Edit design")} ↓</a>
              <a href="#design-results">{bi("查看结果", "View results")} ↓</a>
            </div>
            <div className="workspace">
              <aside className="panel inputs" id="supply-inputs">
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
                        onClick={() => applyPreset(changeMode(d, v))}
                      >
                        {v === "battery" ? <Battery /> : <Sun />}
                        {tr(v)}
                      </button>
                    ))}
                  </div>
                  {flow}
                  <p className="caption">
                    {bi(
                      result?.status === "conditional"
                        ? "当前参数可进行条件演算；假设模板、效率、内阻和光谱换算不是厂家保证值。"
                        : "部分型号参数仍待补充；请查看右侧提示，现阶段不能得到完整续航结果。",
                      result?.status === "conditional"
                        ? "Ready for conditional simulation. Templates, efficiency, resistance and spectrum conversion are not manufacturer guarantees."
                        : "Some model-specific values are still missing. Complete them before relying on a runtime result.",
                    )}
                  </p>
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
                      <label
                        className={`field angle-field ${d.light.planeMeasured ? "angle-disabled" : ""}`}
                      >
                        <span>
                          {bi(
                            "光线照向板面的角度",
                            "Light direction onto the panel",
                          )}
                        </span>
                        <select
                          aria-label={bi(
                            "光线照向板面的角度",
                            "Light direction onto the panel",
                          )}
                          disabled={d.light.planeMeasured}
                          value={d.light.angle}
                          onChange={(e) =>
                            update("light", "angle", Number(e.target.value))
                          }
                        >
                          <option value={0}>
                            {bi(
                              "最佳角度：垂直入射（正对光源）",
                              "Best: directly facing the light",
                            )}
                          </option>
                          <option value={45}>
                            {bi("比较糟糕：45° 斜射", "Worse: 45° tilt")}
                          </option>
                          <option value={22.5}>
                            {bi(
                              "介于以上两者之间（按 22.5° 估算）",
                              "In between (22.5° estimate)",
                            )}
                          </option>
                          <option value={67.5}>
                            {bi(
                              "比 45° 还糟（按 67.5° 估算）",
                              "Worse than 45° (67.5° estimate)",
                            )}
                          </option>
                          {![0, 45, 22.5, 67.5].includes(d.light.angle) && (
                            <option value={d.light.angle}>
                              {bi("已有自定义角度", "Existing custom angle")} ·{" "}
                              {d.light.angle}°
                            </option>
                          )}
                        </select>
                      </label>
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
                        "这个 lux 是照度计贴着光伏板、朝向与板面一致时测得的",
                        "Illuminance measured on the panel plane (no double angle correction)",
                      )}
                    </label>
                    <p className="caption">
                      {bi(
                        d.light.planeMeasured
                          ? "读数已包含倾斜影响，角度选项已停用，不再重复打折。"
                          : "如果只是估计房间亮度，使用上方角度估算板面收到的光。",
                        d.light.planeMeasured
                          ? "The reading includes tilt. Angle correction is disabled."
                          : "For estimated room brightness, use the angle above to approximate light reaching the panel.",
                      )}
                    </p>
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
                    <label className="field">
                      {bi("光伏材料 · 自动配置", "PV material · ready preset")}
                      <select
                        aria-label={bi(
                          "光伏材料 · 自动配置",
                          "PV material · ready preset",
                        )}
                        value={d.pv.componentId}
                        onChange={(e) => {
                          const c = CATALOG.find(
                            (c) => c.id === e.target.value,
                          );
                          if (c) applyPreset(selectComponent(d, c));
                        }}
                      >
                        <option value="powerfilm-ll200-24-75">
                          非晶硅 · PowerFilm LL200-2.4-75
                        </option>
                        <option value="assumed-opv-leh3">
                          OPV · LEH3 演算模板
                        </option>
                        <option value="assumed-perovskite">
                          钙钛矿 · 假设模板
                        </option>
                        {![
                          "powerfilm-ll200-24-75",
                          "assumed-opv-leh3",
                          "assumed-perovskite",
                        ].includes(d.pv.componentId) && (
                          <option value={d.pv.componentId}>
                            {d.pv.componentId}
                          </option>
                        )}
                      </select>
                    </label>
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
                      (v) => applyPreset(changeStorage(d, v as Design["storage"]["kind"])),
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
                    (v) => {
                      const next = cloneDesign(d);
                      if (v === "converter") {
                        const template = CATALOG.find((c) => c.id === "assumed-harvester-regulator")!;
                        applyPreset(selectComponent(next, template));
                      } else {
                        next.path = v as Design["path"];
                        next.regulation = v === "ldo"
                          ? cloneDesign().regulation
                          : { ...next.regulation, componentId: "direct", iqUa: 0, mppt: false, charger: false };
                        next.parameterSources = { ...next.parameterSources };
                        for (const key of Object.keys(next.regulation))
                          next.parameterSources[`regulation.${key}`] = v === "ldo"
                            ? cloneDesign().parameterSources?.[`regulation.${key}`] ?? { kind: "assumption" }
                            : { kind: "assumption", detail: "Direct path has no regulator IC" };
                        applyPreset(next);
                      }
                    },
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
                      disabled={d.path !== "converter"}
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
                      disabled={d.path !== "converter"}
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
              <aside className="panel results" id="design-results">
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
                <p className={result?.status === "conditional" ? "result-conclusion" : "warning"}>{conclusion(d, result)}</p>
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
                    <b>{currentText(result?.averageUa)}</b>
                  </div>
                  <div>
                    {tr("peak")}
                    <b>{currentText(result?.peakUa)}</b>
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
                        ? "/assets/MHO-C404-body-white-display.webp"
                        : "/assets/MOT-U125-body-proportional-display.webp"
                    }
                    alt={d.device}
                    loading="lazy"
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
                {chart(result, d.mode)}
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
                  const r = calculateCached(design);
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
                        <span>{design.path === "direct" ? bi("直接连接", "Direct") : componentLabel(design.regulation.componentId)}</span>
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
                            ? "/assets/MHO-C404-body-white-display.webp"
                            : "/assets/MOT-U125-body-proportional-display.webp"
                        }
                        alt={design.device}
                        loading="lazy"
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
                        {design.mode !== "battery" && <><dt>{tr("area")}</dt><dd>{fmt(design.pv.areaCm2)} cm²</dd></>}
                        <dt>{tr("storage")}</dt>
                        <dd>
                          {design.mode === "pv"
                            ? "—"
                            : componentLabel(design.storage.componentId)}
                        </dd>
                        <dt>{tr("regulation")}</dt>
                        <dd>{design.path === "direct" ? bi("直接连接", "Direct") : componentLabel(design.regulation.componentId)}</dd>
                        {design.mode !== "battery" && <><dt>{tr("lux")}</dt><dd>{design.light.lux}</dd></>}
                      </dl>
                      <p className="warning">
                        {r ? tr(r.status) : tr("incomplete")}
                      </p>
                      <p className="result-conclusion">{conclusion(design, r)}</p>
                      {chart(r, design.mode)}
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
              {lockConditions
                ? bi("正在按当前设计的设备、光照和演算天数比较；快照原始输入未被改写。", "Comparing with the current device, lighting and horizon; original snapshots remain unchanged.")
                : bi("各方案保留自己的设备、光照和演算天数；请先核对条件是否可比。", "Each design keeps its own device, lighting and horizon. Check whether conditions are comparable.")}
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
                      <button
                        onClick={() => useComponent(c)}
                        disabled={!canUseComponent(c)}
                        title={!canUseComponent(c) ? bi("资料条目，暂不支持放入供电路径", "Reference entry; cannot be added to the energy path yet") : undefined}
                      >
                        {canUseComponent(c) ? bi("用于设计", "Use in design") : bi("仅供查看", "Reference only")}
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
        {viewer?.admin && admin && (
          <div
            className="admin-grid"
            style={page === "admin" ? undefined : { display: "none" }}
          >
            <React.Suspense fallback={<p>{bi("正在打开模型设置…", "Opening model settings…")}</p>}>
              <AIAdmin locale={locale} />
            </React.Suspense>
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
      {aiLoaded && <React.Suspense fallback={<p role="status">{bi("正在打开 AI 助手…", "Opening AI assistant…")}</p>}><AIAssistant
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
      /></React.Suspense>}
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
                  "选择型号自动填参数；缺失项采用演算假设，并写入设计记录（不是厂家规格）。供电方式保持不变。",
                  "Catalog values fill automatically; missing values use simulation assumptions recorded in design notes, not manufacturer specifications. Supply mode is preserved.",
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
              <p className={selected.verified ? "caption" : "warning"}>
                {selected.verified
                  ? bi("此条目已有库内核验；具体测试条件仍以原始资料为准。", "This catalog entry has been reviewed; check the original test conditions.")
                  : bi("此条目尚未核验或属于演算模板；未知数据不会被自动补成厂家参数。", "This entry is unverified or illustrative; missing data will not be presented as manufacturer specifications.")}
              </p>
              <table className="parameter-table">
                <thead><tr><th>{bi("参数", "Parameter")}</th><th>{bi("数值", "Value")}</th><th>{bi("状态", "Status")}</th></tr></thead>
                <tbody>
                  {Object.entries(selected.parameters).map(([key, value]) => (
                    <tr key={key}>
                      <td>{({ voltage: "电压 V", minVoltage: "最低电压 V", maxVoltage: "最高电压 V", capacityMah: "容量 mAh", farads: "电容量 F", leakUa: "漏电流 µA", esr: "内阻 Ω", iqUa: "静态电流 µA", densityUwCm2: "功率密度 µW/cm²", referenceLux: "参考照度 lux", areaCm2: "面积 cm²", efficiency: "效率", mppt: "MPPT", charger: "充电管理" } as Record<string, string>)[key] ?? key}</td>
                      <td>{value === null ? bi("待补", "Unknown") : String(value)}</td>
                      <td>{value === null ? bi("未提供", "Missing") : selected.verified ? bi("库内核验", "Reviewed") : bi("待核验", "Unverified")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
              <details>
                <summary>{bi("高级：审核候选参数 JSON", "Advanced: review candidate parameter JSON")}</summary>
                <label className="field">
                  <span>{bi("候选参数 JSON（需审核）", "Candidate parameters JSON (review required)")}</span>
                  <textarea value={params} onChange={(e) => setParams(e.target.value)} />
                </label>
              </details>
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
            {new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })} · Engine {ENGINE_VERSION} · {tr(scope)}
          </p>
          <h2>{tr("results")}</h2>
          <p>{conclusion(d, result)}</p>
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
          <h2>{bi("设计条件", "Design conditions")}</h2>
          <table className="parameter-table"><tbody>
            <tr><th>{tr("device")}</th><td>{d.device}</td><th>{tr("voltage")}</th><td>{fmt(d.load.voltage)} V</td></tr>
            <tr><th>{bi("供电方式", "Supply mode")}</th><td>{tr(d.mode)}</td><th>{tr("regulation")}</th><td>{componentLabel(d.regulation.componentId)}</td></tr>
            {d.mode !== "battery" && <tr><th>{tr("pv")}</th><td>{componentLabel(d.pv.componentId)} · {fmt(d.pv.areaCm2)} cm²</td><th>{tr("light")}</th><td>{fmt(d.light.lux)} lux · {d.light.days} × {fmt(d.light.hours)} h</td></tr>}
            {d.mode !== "pv" && <tr><th>{tr("storage")}</th><td>{componentLabel(d.storage.componentId)} · {d.storage.series}S{d.storage.parallel}P</td><th>{tr("dark")}</th><td>{runtime(result, true)}</td></tr>}
          </tbody></table>
          {reportCompare && <>
            <h2>{bi("方案对比", "Design comparison")}</h2>
            <p>{lockConditions
              ? bi("比较使用当前设计的设备负载、光照与演算天数。", "Comparison uses the current device load, lighting and simulation horizon.")
              : bi("比较保留各方案原有条件。", "Comparison retains each design's original conditions.")}</p>
            <table className="parameter-table"><thead><tr><th>{tr("name")}</th><th>{bi("供电", "Supply")}</th><th>{tr("runtime")}</th><th>{bi("状态", "Status")}</th></tr></thead><tbody>
              {[...snapshots, d].map((item, i) => {
                const design = lockConditions ? { ...item, load: d.load, light: d.light, horizonDays: d.horizonDays, device: d.device } : item;
                const r = calculateCached(design);
                return <tr key={i}><td>{item.name}</td><td>{tr(design.mode)}</td><td>{r?.status === "conditional" ? r.runtimeHours === null ? `≥ ${design.horizonDays * 24} h` : `${fmt(r.runtimeHours)} h` : "—"}</td><td>{r ? tr(r.status) : tr("incomplete")}</td></tr>;
              })}
            </tbody></table>
          </>}
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
          <table className="parameter-table"><thead><tr><th>{bi("参数", "Parameter")}</th><th>{bi("数值", "Value")}</th><th>{bi("依据", "Basis")}</th></tr></thead><tbody>
            {Object.entries(d.parameterSources ?? {}).map(([path, source]) => {
              const [group, key] = path.split(".");
              const value = (d as any)[group]?.[key];
              return <tr key={path}><td>{path}</td><td>{value === null || value === undefined ? "—" : String(value)}</td><td>{source.kind} · {source.reference ?? source.detail ?? ""}</td></tr>;
            })}
          </tbody></table>
          <p>ZenMeasure · https://powermatch.zenmeasure.space</p>
        </article>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppRecovery><App /></AppRecovery>
  </React.StrictMode>,
);

import React, { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { api, ApiError } from "./api";
import {
  cloneDesign,
  type Design,
  type Scope,
  type Viewer,
} from "./shared/model";
import {
  comparisonFingerprint,
  comparisonUrl,
  type ComparisonContext,
  type ComparisonDetail,
  type ComparisonSnapshot,
} from "./shared/comparisons";

type Item = Pick<
  ComparisonDetail,
  "id" | "name" | "scope" | "latest_revision" | "canEdit"
>;
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement,
      overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("button,input,select")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab") {
        const items = Array.from(
            ref.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]",
            ) ?? [],
          ),
          first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return (
    <div
      className="backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="section-title">
          <h2>{title}</h2>
          <button aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function CloudComparisons({
  design,
  snapshots,
  locked,
  viewer,
  ready,
  context,
  onContext,
  onLoad,
  onSessionFailure,
  sourceRevisions,
  linked,
  onLinkedHandled,
  bi,
}: {
  design: Design;
  snapshots: Design[];
  locked: boolean;
  viewer: Viewer | null;
  ready: boolean;
  context: ComparisonContext | null;
  onContext: (value: ComparisonContext | null) => void;
  onLoad: (detail: ComparisonDetail) => void;
  onSessionFailure: () => void;
  sourceRevisions: { id: string; design: Design }[];
  linked: { id: string; revision?: number } | null;
  onLinkedHandled: () => void;
  bi: (zh: string, en: string) => string;
}) {
  const [mode, setMode] = useState<"save" | "browse" | "load" | null>(null),
    [name, setName] = useState(""),
    [scope, setScope] = useState<Scope>(
      viewer?.employee ? "private" : "public",
    );
  const [items, setItems] = useState<Item[]>([]),
    [listScope, setListScope] = useState("mine"),
    [nextOffset, setNextOffset] = useState<number | null>(null),
    [selected, setSelected] = useState<ComparisonDetail | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [bindings, setBindings] = useState<ComparisonSnapshot[]>([]),
    [confirmed, setConfirmed] = useState(false);
  const [associationReady, setAssociationReady] = useState(!context);
  const actor = viewer?.id ?? "guest",
    actorRef = useRef(actor),
    epoch = useRef(0),
    request = useRef(0),
    readyRef = useRef(ready),
    draftRef = useRef("");
  actorRef.current = actor;
  readyRef.current = ready;
  const draft = comparisonFingerprint({ design, snapshots, locked });
  draftRef.current = draft;
  const retry = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const operation = useRef(0);
  useEffect(() => {
    ++epoch.current;
    ++request.current;
    ++operation.current;
    setBusy(false);
    setMode(null);
    setItems([]);
    setSelected(null);
    setBindings([]);
    setName("");
    setScope(viewer?.employee ? "private" : "public");
    setConfirmed(false);
    setError("");
    retry.current = null;
  }, [actor]);
  useEffect(() => {
    if (!ready) {
      ++request.current;
      ++operation.current;
      setBusy(false);
      setMode(null);
      setSelected(null);
    }
  }, [ready]);
  useEffect(() => {
    setScope(
      context?.originalScope ?? (viewer?.employee ? "private" : "public"),
    );
    setConfirmed(false);
  }, [context?.id]);
  useEffect(() => {
    setConfirmed(false);
  }, [draft]);
  useEffect(() => {
    if (!context) {
      setAssociationReady(true);
      setBindings([]);
      return;
    }
    setAssociationReady(false);
    setBindings([]);
    if (!ready) return;
    const owner = actor,
      capturedEpoch = epoch.current;
    let active = true;
    api(
      "/comparisons/" +
        encodeURIComponent(context.id) +
        "?revision=" +
        context.expectedRevision,
      undefined,
      "GET",
      owner,
    )
      .then(async (response) => {
        if (
          !active ||
          actorRef.current !== owner ||
          epoch.current !== capturedEpoch ||
          !readyRef.current
        )
          return;
        if (!(await safe(owner, capturedEpoch)) || !active) return;
        setBindings(response.comparison.snapshots);
        setName((previous) => previous || response.comparison.name);
        setAssociationReady(true);
      })
      .catch((e) => {
        if (
          active &&
          actorRef.current === owner &&
          epoch.current === capturedEpoch
        ) {
          if (e instanceof ApiError && e.message === "identity-conflict")
            onSessionFailure();
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      active = false;
    };
  }, [context?.id, context?.expectedRevision, actor, ready]);
  const safe = async (owner: string, capturedEpoch: number) => {
    try {
      const session = await api("/session");
      if (
        actorRef.current !== owner ||
        epoch.current !== capturedEpoch ||
        !readyRef.current
      )
        return false;
      if (
        (session.user?.id ?? "guest") !== owner ||
        !!session.user?.employee !== !!viewer?.employee
      ) {
        onSessionFailure();
        setError(
          bi(
            "身份或权限已改变；请重新核实身份。",
            "Identity or permissions changed. Verify your session again.",
          ),
        );
        return false;
      }
      return true;
    } catch {
      if (actorRef.current === owner && epoch.current === capturedEpoch)
        onSessionFailure();
      return false;
    }
  };
  const execute = async (fn: () => Promise<void>) => {
    const owner = actor,
      capturedEpoch = epoch.current,
      op = ++operation.current;
    const applies = () =>
      actorRef.current === owner &&
      epoch.current === capturedEpoch &&
      operation.current === op;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (applies()) {
        if (e instanceof ApiError && e.message === "identity-conflict")
          onSessionFailure();
        const message = e instanceof Error ? e.message : String(e);
        setError(
          message === "revision-conflict"
            ? bi(
                "集合已有新修订。当前输入及原修订号已保留，请另存集合，或重新打开后合并。",
                "This collection has a newer revision. Your inputs and original revision are preserved. Save a new collection, or reopen it to merge.",
              )
            : message === "source-scope-conflict"
              ? bi(
                  "来源案例的可见范围更窄。请选择仅自己或同等范围。",
                  "A source case has narrower visibility. Choose Only me or an equally restricted scope.",
                )
              : message === "source-unavailable"
                ? bi(
                    "来源修订不可访问；已保留当前草稿。",
                    "A source revision is unavailable. Your current draft is preserved.",
                  )
                : message === "request-timeout-outcome-unknown"
                  ? bi(
                      "暂时无法确认保存结果。请先打开集合列表核实；重试同一内容会沿用请求编号，避免重复保存。",
                      "The save outcome is unknown. Check the collection list first; retrying the same content reuses its request ID to prevent duplicate saves.",
                    )
                  : message === "identity-conflict"
                    ? bi(
                        "身份已改变；已停止读取或保存，请重新核实。",
                        "Your identity changed. Reading or saving stopped; verify your session again.",
                      )
                    : message,
        );
      }
    } finally {
      if (applies()) setBusy(false);
    }
  };
  const list = async (filter: string, offset = 0) => {
    const owner = actor,
      capturedEpoch = epoch.current,
      sequence = ++request.current;
    const response = await api(
      `/comparisons?scope=${filter}&limit=20&offset=${offset}`,
      undefined,
      "GET",
      owner,
    );
    if (
      actorRef.current !== owner ||
      epoch.current !== capturedEpoch ||
      request.current !== sequence ||
      !readyRef.current
    )
      return;
    if (!(await safe(owner, capturedEpoch)) || request.current !== sequence)
      return;
    setItems((previous) =>
      offset ? [...previous, ...response.comparisons] : response.comparisons,
    );
    setNextOffset(response.nextOffset);
  };
  const load = async (id: string, revision?: number) => {
    const owner = actor,
      capturedEpoch = epoch.current,
      sequence = ++request.current;
    const response = await api(
      "/comparisons/" +
        encodeURIComponent(id) +
        (revision ? "?revision=" + revision : ""),
      undefined,
      "GET",
      owner,
    );
    if (
      actorRef.current !== owner ||
      epoch.current !== capturedEpoch ||
      request.current !== sequence ||
      !readyRef.current
    )
      return;
    if (!(await safe(owner, capturedEpoch))) return;
    if (request.current !== sequence) return;
    setSelected(response.comparison);
    setMode("load");
  };
  const replace = async () => {
    if (!selected) return;
    const owner = actor,
      capturedEpoch = epoch.current,
      sequence = ++request.current,
      before = draftRef.current;
    // Re-read permissions and content immediately before applying the explicit replacement.
    const response = await api(
      "/comparisons/" +
        encodeURIComponent(selected.id) +
        "?revision=" +
        selected.revision,
      undefined,
      "GET",
      owner,
    );
    if (!(await safe(owner, capturedEpoch)) || request.current !== sequence)
      return;
    if (before !== draftRef.current) {
      setError(
        bi(
          "核实期间草稿有更新；已保留输入，请再次确认打开。",
          "The draft changed during verification. Inputs are preserved; confirm opening again.",
        ),
      );
      return;
    }
    const detail = response.comparison as ComparisonDetail;
    setBindings(detail.snapshots);
    setName(detail.name);
    setScope(detail.scope);
    setConfirmed(false);
    onLoad(detail);
    onContext({
      id: detail.id,
      expectedRevision: detail.revision,
      originalScope: detail.scope,
    });
    history.replaceState(
      {},
      "",
      comparisonUrl(new URL(location.href), detail.id, detail.revision),
    );
    onLinkedHandled();
    setMode(null);
  };
  const save = async (copy: boolean) => {
    if (!associationReady) return;
    const owner = actor,
      capturedEpoch = epoch.current,
      sequence = ++request.current,
      before = draftRef.current;
    if (!(await safe(owner, capturedEpoch)) || request.current !== sequence)
      return;
    if (before !== draftRef.current) {
      setError(
        bi(
          "核实期间草稿有更新；请检查后重新保存。",
          "The draft changed during verification. Review it before saving.",
        ),
      );
      return;
    }
    const designs = [...snapshots, design],
      originals = [
        ...bindings,
        ...sourceRevisions.map((x) => ({
          design: x.design,
          sourceRevision: x.id,
        })),
      ];
    const payload = {
      ...(context && !copy
        ? { id: context.id, expectedRevision: context.expectedRevision }
        : {}),
      expectedActor: owner,
      name,
      scope,
      locked,
      snapshots: designs.map((d) => ({
        design: cloneDesign(d),
        sourceRevision:
          originals.find(
            (x) =>
              x.sourceRevision &&
              comparisonFingerprint(x.design) === comparisonFingerprint(d),
          )?.sourceRevision ?? null,
      })),
    };
    const fingerprint = comparisonFingerprint(payload);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, requestId: crypto.randomUUID() };
    const response = await api(
      "/comparisons",
      { ...payload, requestId: retry.current!.requestId },
      "POST",
      owner,
    );
    if (
      actorRef.current !== owner ||
      epoch.current !== capturedEpoch ||
      request.current !== sequence ||
      !readyRef.current
    )
      return;
    if (!(await safe(owner, capturedEpoch)) || request.current !== sequence)
      return;
    if (before !== draftRef.current) {
      setError(
        bi(
          "云端已保存操作开始时的快照；当前草稿已保留。请从集合列表核实。",
          "The cloud saved the snapshots captured when saving began. Your current draft is preserved; verify the saved collection in the list.",
        ),
      );
      return;
    }
    const detail = response.comparison as ComparisonDetail;
    // Only server-readback snapshots establish the association. Saving never replaces local input.
    setBindings(detail.snapshots);
    onContext({
      id: detail.id,
      expectedRevision: detail.revision,
      originalScope: detail.scope,
    });
    history.replaceState(
      {},
      "",
      comparisonUrl(new URL(location.href), detail.id, detail.revision),
    );
    retry.current = null;
    setMode(null);
  };
  const close = () => {
    ++request.current;
    ++operation.current;
    setBusy(false);
    setMode(null);
    setSelected(null);
  };
  const openSave = () => {
    setName(name || design.name + " · " + bi("对比", "Comparison"));
    setConfirmed(false);
    setMode("save");
    setError("");
  };
  return (
    <>
      <div className="panel comparison-cloud">
        <div className="toolbar">
          <strong>{bi("云端对比集合", "Cloud comparison collections")}</strong>
          <button
            disabled={
              !ready || busy || !associationReady || snapshots.length < 1
            }
            onClick={openSave}
          >
            {bi("保存集合", "Save collection")}
          </button>
          <button
            disabled={!ready || busy}
            onClick={() => {
              setMode("browse");
              void execute(() => list(listScope));
            }}
          >
            {bi("打开集合", "Open collection")}
          </button>
          {context && (
            <span className="caption">
              {bi("已关联修订", "Linked revision")} {context.expectedRevision}
              {!associationReady
                ? " · " + bi("待核实", "Verification required")
                : ""}
            </span>
          )}
          {context && (
            <button
              disabled={!ready || busy}
              onClick={() => {
                onContext(null);
                setBindings([]);
                history.replaceState(
                  {},
                  "",
                  location.pathname + "?page=compare",
                );
              }}
            >
              {bi("解除关联", "Detach")}
            </button>
          )}
          {context && (
            <button
              onClick={() =>
                void execute(async () => {
                  await navigator.clipboard.writeText(
                    comparisonUrl(
                      new URL(location.href),
                      context.id,
                      context.expectedRevision,
                    ),
                  );
                })
              }
            >
              {bi("复制链接", "Copy link")}
            </button>
          )}
        </div>
        <p className="caption">
          {bi(
            "集合保存最多 3 个快照和当前设计的独立副本、共同条件开关及来源版本；报告仍在导出时冻结。打开集合会先请求确认。",
            "Collections save independent copies of up to 3 snapshots and the current design, common-condition setting and source versions. Reports freeze when exported. Opening requires confirmation.",
          )}
        </p>
        {linked && (
          <button
            disabled={!ready || busy}
            onClick={() => void execute(() => load(linked.id, linked.revision))}
          >
            {bi("打开链接中的集合", "Open linked collection")}
          </button>
        )}
        {error && !mode && (
          <p role="alert" className="warning">
            {error}
          </p>
        )}
      </div>
      {mode && (
        <Dialog
          title={
            mode === "save"
              ? bi("保存对比集合", "Save comparison collection")
              : mode === "load"
                ? bi("确认打开集合", "Confirm opening collection")
                : bi("云端对比集合", "Cloud comparison collections")
          }
          onClose={close}
        >
          {mode === "browse" && (
            <>
              <div className="toolbar">
                {[
                  "mine",
                  "public",
                  ...(viewer?.employee ? ["company", "private"] : []),
                ].map((s) => (
                  <button
                    key={s}
                    className={listScope === s ? "active" : ""}
                    disabled={busy}
                    onClick={() => {
                      setListScope(s);
                      void execute(() => list(s));
                    }}
                  >
                    {bi(
                      (
                        {
                          mine: "我的",
                          public: "公开",
                          company: "公司",
                          private: "仅自己",
                        } as Record<string, string>
                      )[s],
                      s,
                    )}
                  </button>
                ))}
              </div>
              {!busy && !items.length && (
                <p>{bi("暂无可读取的集合。", "No readable collections.")}</p>
              )}
              {items.map((item) => (
                <div className="panel" key={item.id}>
                  <strong>{item.name}</strong>
                  <p>
                    {item.scope} · v{item.latest_revision}
                  </p>
                  <button
                    disabled={busy}
                    onClick={() => void execute(() => load(item.id))}
                  >
                    {bi("打开并检查", "Open and review")}
                  </button>
                </div>
              ))}
              {nextOffset !== null && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void execute(() => list(listScope, nextOffset))
                  }
                >
                  {bi("加载更多", "Load more")}
                </button>
              )}
            </>
          )}
          {mode === "save" && (
            <>
              <label className="field">
                <span>{bi("集合名称", "Collection name")}</span>
                <input
                  disabled={busy}
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="field">
                <span>{bi("可见范围", "Visibility")}</span>
                <select
                  disabled={busy}
                  value={scope}
                  onChange={(e) => {
                    setScope(e.target.value as Scope);
                    setConfirmed(false);
                  }}
                >
                  <option value="public">{bi("公开", "Public")}</option>
                  {viewer?.employee && (
                    <>
                      <option value="private">{bi("仅自己", "Only me")}</option>
                      <option value="company">{bi("公司", "Company")}</option>
                    </>
                  )}
                </select>
              </label>
              <ul>
                {[...snapshots, design].map((item, i) => (
                  <li key={i}>{item.name}</li>
                ))}
              </ul>
              <p>
                {bi(
                  "将保存以上方案的全部输入、备注及来源资料。公开/公司集合不能包含范围更窄的已绑定案例修订。",
                  "All inputs, notes and source evidence for the designs above will be saved. Public/company collections cannot include bound source revisions with narrower visibility.",
                )}
              </p>
              {scope !== "private" && (
                <label className="check">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  {scope === "public"
                    ? bi(
                        "确认所有人可读取上述完整方案",
                        "Confirm everyone may read these complete designs",
                      )
                    : bi(
                        "确认全体员工可读取上述完整方案",
                        "Confirm all employees may read these complete designs",
                      )}
                </label>
              )}
              <div className="toolbar">
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !ready ||
                    !name.trim() ||
                    (scope !== "private" && !confirmed)
                  }
                  onClick={() => void execute(() => save(false))}
                >
                  {context
                    ? bi("保存新修订", "Save new revision")
                    : bi("保存", "Save")}
                </button>
                {context && (
                  <button
                    disabled={
                      busy ||
                      !ready ||
                      !name.trim() ||
                      (scope !== "private" && !confirmed)
                    }
                    onClick={() => void execute(() => save(true))}
                  >
                    {bi("另存为新集合", "Save as new collection")}
                  </button>
                )}
              </div>
            </>
          )}
          {mode === "load" && selected && (
            <>
              <h3>
                {selected.name} · v{selected.revision}
              </h3>
              <p>
                {bi(
                  "打开将替换当前设计和对比快照，包括未保存的输入；关闭本窗口可完整保留草稿。",
                  "Opening replaces the current design and comparison snapshots, including unsaved inputs. Close this dialog to preserve the draft.",
                )}
              </p>
              <ul>
                {selected.snapshots.map((item, i) => (
                  <li key={i}>
                    {item.design.name} · {item.engineVersion ?? "—"} ·{" "}
                    {item.provenance}
                  </li>
                ))}
              </ul>
              <p>
                {bi(
                  "来源版本已冻结；当前引擎会重新演算，不把旧引擎结果说成已复现。",
                  "Source versions are frozen. The current engine recalculates the inputs; this does not reproduce an older engine result.",
                )}
              </p>
              <button
                className="primary"
                disabled={busy || !ready}
                onClick={() => void execute(replace)}
              >
                {bi("确认替换并打开", "Confirm replacement and open")}
              </button>
              <button disabled={busy} onClick={close}>
                {bi("保留当前草稿", "Keep current draft")}
              </button>
            </>
          )}
          {busy && <p role="status">{bi("正在核实…", "Verifying…")}</p>}
          {error && (
            <p role="alert" className="warning">
              {error}
            </p>
          )}
        </Dialog>
      )}
    </>
  );
}

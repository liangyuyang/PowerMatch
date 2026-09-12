import React, { useEffect, useId, useRef, useState } from "react";
import type { Component } from "./shared/model";

export function ComponentHover({
  component,
  summary,
  onDetails,
  children,
}: {
  component: Component;
  summary: string;
  onDetails: (c: Component) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false),
    ref = useRef<HTMLDivElement>(null),
    id = useId(),
    suppressFocus = useRef(false);
  const close = () => setOpen(false);
  const dismiss = () => {
    close();
    suppressFocus.current = true;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    suppressFocus.current = false;
  };
  useEffect(() => {
    if (!open) return;
    const pointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      }
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div
      className="component-hover"
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={close}
      onFocus={(e) => {
        if (
          !suppressFocus.current &&
          !e.currentTarget.contains(e.relatedTarget)
        )
          setOpen(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) close();
      }}
    >
      {children}
      <button
        className="component-info-trigger"
        aria-label={`${component.name} · 信息`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(true)}
      >
        ⓘ
      </button>
      {open && (
        <div
          className="component-popover"
          id={id}
          role="region"
          aria-label={`${component.name} · 概况`}
        >
          <button
            className="popover-close"
            onClick={dismiss}
            aria-label="关闭元器件气泡"
          >
            ×
          </button>
          <strong>{component.name}</strong>
          <small>{component.manufacturer}</small>
          <p>{summary}</p>
          <p>
            {component.verified
              ? "规格来源已记录，运行结果仍需实测"
              : "包含演算假设或待核实参数"}
          </p>
          <a
            href={`#component=${encodeURIComponent(component.id)}`}
            onClick={(e) => {
              e.preventDefault();
              close();
              onDetails(component);
            }}
          >
            查看元器件详情 →
          </a>
        </div>
      )}
    </div>
  );
}

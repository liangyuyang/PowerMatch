import React, { useEffect, useRef, useState } from "react";
import type { Result } from "./shared/engine";
import type { Design, Locale } from "./shared/model";
const EnergyChart = React.lazy(() => import("./energy-chart"));

// Do not mount several expensive SVG charts when comparison cards are below the fold.
export default function DeferredEnergyChart(props: { result: Result; mode: Design["mode"]; locale: Locale }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    if (!("IntersectionObserver" in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const loading = props.locale === "zh" ? "正在绘制曲线…" : "Drawing chart…";
  return <div ref={ref} style={{ minHeight: 210 }}>
    {visible ? <React.Suspense fallback={<p className="caption">{loading}</p>}><EnergyChart {...props}/></React.Suspense>
      : <p className="caption">{props.locale === "zh" ? "滚动至此查看曲线。" : "Scroll here to view the chart."}</p>}
  </div>;
}

import React, {useId} from "react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { Result } from "./shared/engine";
import type { Design, Locale } from "./shared/model";
import { t } from "./i18n";
import {uiText} from './ui-text';

const fmt = (n: number, decimals = 2) => Number(n.toFixed(decimals)).toString();
export default React.memo(function EnergyChart({ result, mode, locale }: {
  result: Result;
  mode: Design["mode"];
  locale: Locale;
}) {
  const gradient = useId().replaceAll(':','');
  if (mode === "pv") return <>
    <p className="caption">{uiText(locale,'noStorageChart')}</p>
    <ResponsiveContainer width="100%" height={210}>
      <LineChart data={result.trace}>
        <CartesianGrid strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey="hour" type="number" domain={[0, "dataMax"]} tickCount={5} unit="h" tickFormatter={(n) => fmt(n, 0)} />
        <YAxis unit="µW" />
        <Tooltip labelFormatter={(n) => `${fmt(Number(n))} h`} formatter={(v)=>`${fmt(Number(v))} µW`} />
        <Line type="stepAfter" dataKey="harvestUw" name={uiText(locale,'pvInput')} stroke="#2563eb" dot={false} isAnimationActive={false} />
        <Line type="stepAfter" dataKey="loadUw" name={uiText(locale,'deviceDemand')} stroke="#b45309" dot={false} isAnimationActive={false} />
        <Legend />
      </LineChart>
    </ResponsiveContainer>
  </>;
  return <ResponsiveContainer width="100%" height={210}>
    <AreaChart data={result.trace}>
      <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#2563eb" stopOpacity={0.28} />
        <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
      </linearGradient></defs>
      <CartesianGrid strokeDasharray="3 5" vertical={false} />
      <XAxis dataKey="hour" type="number" domain={[0, "dataMax"]} tickCount={5} unit="h" tickFormatter={(n) => fmt(n, 0)} />
      <YAxis domain={[0, 100]} unit="%" />
      <Tooltip labelFormatter={(n) => `${fmt(Number(n))} h`} formatter={(v)=>`${fmt(Number(v))} %`} />
      <Area type="monotone" dataKey="percent" name={t(locale, "storage")} stroke="#2563eb" fill={`url(#${gradient})`} isAnimationActive={false} />
    </AreaChart>
  </ResponsiveContainer>;
});

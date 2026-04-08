import React from "react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, AreaChart, ReferenceLine,
} from "recharts";
import { formatDate } from "../utils.js";
import { useTheme } from "../theme.jsx";

export default function BurndownChart({ cycle, mode = "points" }) {
  const { colors: c } = useTheme();
  const scopeHist = mode === "points" ? cycle.scopeHistory : cycle.issueCountHistory;
  const completedHist = mode === "points" ? cycle.completedScopeHistory : cycle.completedIssueCountHistory;
  const inProgHist = mode === "points" ? (cycle.inProgressScopeHistory || []) : [];

  const start = new Date(cycle.startsAt);
  const end = new Date(cycle.endsAt);
  const totalDays = Math.ceil((end - start) / 86400000);
  const today = new Date();
  const hasData = scopeHist && scopeHist.length > 0;

  const chartData = [];

  if (hasData) {
    const totalScope = scopeHist[0] || 0;
    for (let i = 0; i < scopeHist.length; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const scope = scopeHist[i] || 0;
      const completed = completedHist[i] || 0;
      chartData.push({
        day: i,
        label: formatDate(d),
        remaining: Math.max(0, scope - completed),
        ideal: Math.max(0, Math.round((totalScope - (totalScope / totalDays) * i) * 10) / 10),
        scope,
        completed,
        inProgress: inProgHist[i] || 0,
      });
    }
  } else {
    for (let i = 0; i <= totalDays; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      chartData.push({ day: i, label: formatDate(d), remaining: null, ideal: null });
    }
  }

  const todayIdx = Math.floor((today - start) / 86400000);

  if (!hasData) {
    return (
      <div style={{
        background: c.card, border: `1px solid ${c.border}`, borderRadius: 8,
        padding: "32px 20px", textAlign: "center",
      }}>
        <div style={{ fontSize: 13, color: c.textMuted, marginBottom: 6 }}>No burndown data yet</div>
        <div style={{ fontSize: 11, color: c.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
          Cycle {cycle.number} starts {formatDate(cycle.startsAt, { weekday: "long", month: "long", day: "numeric" })}
        </div>
        <div style={{ marginTop: 16, height: 140 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={c.gridLine} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: c.textMuted }}
                interval={Math.floor(chartData.length / 5)} axisLine={{ stroke: c.gridLine }} tickLine={false} />
              <YAxis tick={false} axisLine={false} width={20} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: c.card, border: `1px solid ${c.border}`, borderRadius: 8,
      padding: "16px 12px 8px 4px",
    }}>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="burndownGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c.accent} stopOpacity={0.2} />
              <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={c.gridLine} />
          <XAxis dataKey="label"
            tick={{ fontSize: 10, fill: c.textMuted, fontFamily: "monospace" }}
            interval={Math.max(1, Math.floor(chartData.length / 7))}
            axisLine={{ stroke: c.gridLine }} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: c.textMuted, fontFamily: "monospace" }}
            axisLine={false} tickLine={false} width={32} />
          <Tooltip contentStyle={{
            background: c.tooltip, border: `1px solid ${c.border}`, borderRadius: 6,
            fontSize: 12, fontFamily: "monospace", color: c.text,
          }} labelStyle={{ color: c.textMuted }} />
          {todayIdx >= 0 && todayIdx < chartData.length && (
            <ReferenceLine x={chartData[todayIdx]?.label} stroke={c.textMuted} strokeDasharray="4 4"
              label={{ value: "Today", position: "top", fontSize: 10, fill: c.textMuted }} />
          )}
          <Area type="monotone" dataKey="remaining" stroke={c.accent} strokeWidth={2}
            fill="url(#burndownGrad)" dot={false} name="Remaining" />
          <Area type="monotone" dataKey="ideal" stroke={c.textMuted} strokeDasharray="6 3"
            strokeWidth={1.5} fill="none" dot={false} name="Ideal" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

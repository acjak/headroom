import React, { useState } from "react";
import CapacityBar from "./CapacityBar.jsx";
import { statusIcon, statusColor, priorityColor, priorityLabel, initials } from "../utils.js";
import { useTheme } from "../theme.jsx";

export default function PersonCard({ name, issues, capacity }) {
  const { colors: c } = useTheme();
  const [expanded, setExpanded] = useState(true);
  const totalEst = issues.reduce((s, i) => s + (i.estimate || 0), 0);
  const inProg = issues.filter((i) => i.stateType === "started");
  const todo = issues.filter((i) => i.stateType === "unstarted" || i.stateType === "backlog");
  const done = issues.filter((i) => i.stateType === "completed");
  const unest = issues.filter((i) => !i.estimate);
  const over = capacity > 0 && totalEst > capacity;

  return (
    <div style={{
      background: c.card, borderRadius: 8, padding: "18px 20px",
      border: over ? `1px solid ${c.redBorder}` : `1px solid ${c.border}`,
      cursor: "pointer",
    }} onClick={() => setExpanded((e) => !e)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: "50%",
            background: over ? c.redBg : c.accentBg,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 600,
            color: over ? c.red : c.accent,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {initials(name)}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: c.text }}>{name}</div>
            <div style={{ fontSize: 11, color: c.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
              {inProg.length} active · {todo.length} todo · {done.length} done
              {unest.length > 0 && <span style={{ color: c.yellow }}> · {unest.length} unest.</span>}
            </div>
          </div>
        </div>
        {over && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: c.red,
            background: c.redBg, padding: "2px 8px", borderRadius: 4,
            textTransform: "uppercase", letterSpacing: 0.5,
          }}>Over capacity</span>
        )}
      </div>

      <CapacityBar assigned={totalEst} capacity={capacity} />

      {expanded && (
        <>
          {issues.length > 0 && (
            <div style={{ marginTop: 14 }}>
              {[...inProg, ...todo, ...done].map((issue) => (
                <div key={issue.id} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "5px 0", borderTop: `1px solid ${c.divider}`, fontSize: 13,
                }}>
                  <span style={{
                    fontSize: 12, width: 16, textAlign: "center",
                    color: statusColor(issue.stateType),
                  }} title={issue.stateName}>
                    {statusIcon(issue.stateType)}
                  </span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                    color: c.textMuted, minWidth: 56,
                  }}>{issue.identifier}</span>
                  <a href={`https://linear.app/issue/${issue.identifier}`} target="_blank" rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      flex: 1, color: c.textSecondary, textDecoration: "none",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{issue.title}</a>
                  {issue.priority > 0 && (
                    <span style={{
                      fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                      color: priorityColor(issue.priority), fontWeight: 600,
                    }}>{priorityLabel(issue.priority)}</span>
                  )}
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                    color: issue.estimate ? c.text : c.yellow,
                    fontWeight: issue.estimate ? 600 : 400,
                    minWidth: 28, textAlign: "right",
                  }}>
                    {issue.estimate ? `${issue.estimate}pt` : "\u2014"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

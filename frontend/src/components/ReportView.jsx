import React, { useState, useEffect } from "react";
import { useTheme } from "../theme.jsx";
import Logo from "./Logo.jsx";
import { formatDate } from "../utils.js";

const MONO = "'JetBrains Mono', 'SF Mono', monospace";
const SANS = "'DM Sans', system-ui, sans-serif";

export default function ReportView({ token }) {
  const { colors: c } = useTheme();
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/report/${token}`);
        if (!res.ok) {
          setError(res.status === 404 ? "Report not found or has been revoked." : "Failed to load report.");
          return;
        }
        setReport(await res.json());
      } catch {
        setError("Failed to load report.");
      }
    })();
  }, [token]);

  if (error) {
    return (
      <div style={{ fontFamily: SANS, background: c.bg, color: c.text, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <Logo size={32} />
          <div style={{ fontSize: 15, color: c.textMuted, marginTop: 12 }}>{error}</div>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div style={{ fontFamily: SANS, background: c.bg, color: c.text, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 13, color: c.textMuted }}>Loading report...</div>
      </div>
    );
  }

  const s = report.snapshot;
  const u = s.unit === "points" ? "p" : "h";

  return (
    <div style={{ fontFamily: SANS, background: c.bg, color: c.text, minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Logo size={20} />
              <span style={{ fontSize: 16, fontWeight: 700 }}>Capacycle</span>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 4px", letterSpacing: -0.3 }}>
              {s.teamName} &middot; Cycle {s.cycleNumber}
            </h1>
            <div style={{ fontSize: 12, color: c.textMuted, fontFamily: MONO }}>
              {formatDate(s.cycleStart)} &ndash; {formatDate(s.cycleEnd)}
              {" "}&middot; Report generated {formatDate(report.createdAt)}
            </div>
          </div>
        </div>

        {/* Note */}
        {report.note && (
          <div style={{
            background: c.card, border: `1px solid ${c.border}`, borderRadius: 8,
            padding: "14px 18px", marginBottom: 20, fontSize: 14,
            color: c.textSecondary, lineHeight: 1.6, whiteSpace: "pre-wrap",
          }}>
            {report.note}
          </div>
        )}

        {/* Summary strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 10, marginBottom: 24 }}>
          {[
            { label: "Issues", value: s.issueCount, color: c.text },
            { label: "Assigned", value: `${s.totalPts}${u}`, color: c.accent },
            { label: "Done", value: `${s.donePts}${u}`, color: c.green },
            { label: "Progress", value: `${s.pctDone}%`, color: s.pctDone > 60 ? c.green : c.textSecondary },
            { label: "Capacity", value: `${s.totalCap}${u}`, color: s.totalPts > s.totalCap ? c.red : c.textSecondary },
            { label: "Unestimated", value: s.unestCount, color: s.unestCount > 0 ? c.yellow : c.textMuted },
          ].map((stat) => (
            <div key={stat.label} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: stat.color, fontFamily: MONO }}>{stat.value}</div>
              <div style={{ fontSize: 9, color: c.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Progress by project */}
        {s.projects && s.projects.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: c.textSecondary, marginBottom: 10 }}>Progress by project</div>
            <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 70px 60px 60px",
                gap: 8, padding: "8px 16px", fontSize: 10, fontWeight: 600,
                color: c.textMuted, textTransform: "uppercase", letterSpacing: 0.5,
                borderBottom: `1px solid ${c.border}`,
              }}>
                <span>Project</span>
                <span>Points</span>
                <span></span>
                <span>Done</span>
              </div>
              {s.projects.map((proj) => (
                <React.Fragment key={proj.name}>
                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 70px 60px 60px",
                    gap: 8, padding: "10px 16px", fontSize: 13,
                    borderBottom: `1px solid ${c.divider}`, alignItems: "center",
                  }}>
                    <div style={{ fontWeight: 600 }}>{proj.name}</div>
                    <div style={{ fontFamily: MONO, fontSize: 12 }}>
                      <span style={{ color: c.green }}>{proj.done}</span>
                      <span style={{ color: c.textDim }}>/</span>
                      <span style={{ color: c.textSecondary }}>{proj.total}{u}</span>
                    </div>
                    <div>
                      <div style={{ height: 6, background: c.barTrack, borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${proj.pct}%`, height: "100%", borderRadius: 3, background: c.green, opacity: 0.8 }} />
                      </div>
                    </div>
                    <span style={{ fontFamily: MONO, fontSize: 12, color: proj.pct === 100 ? c.green : c.textSecondary }}>{proj.pct}%</span>
                  </div>
                  {(proj.milestones || []).map((ms) => (
                    <div key={ms.name} style={{
                      display: "grid", gridTemplateColumns: "1fr 70px 60px 60px",
                      gap: 8, padding: "8px 16px 8px 36px", fontSize: 12,
                      borderBottom: `1px solid ${c.divider}`, alignItems: "center",
                      color: c.textSecondary,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: c.textDim }}>&#8627;</span>
                        <span>{ms.name}</span>
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 11 }}>
                        <span style={{ color: c.green }}>{ms.done}</span>
                        <span style={{ color: c.textDim }}>/</span>
                        <span>{ms.total}{u}</span>
                      </div>
                      <div>
                        <div style={{ height: 4, background: c.barTrack, borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ width: `${ms.pct}%`, height: "100%", borderRadius: 2, background: c.green, opacity: 0.7 }} />
                        </div>
                      </div>
                      <span style={{ fontFamily: MONO, fontSize: 11, color: ms.pct === 100 ? c.green : c.textMuted }}>{ms.pct}%</span>
                    </div>
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {/* Scope change */}
        {s.scopeChange != null && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: c.textSecondary, marginBottom: 10 }}>Scope change</div>
            <div style={{
              background: c.card, border: `1px solid ${c.border}`, borderRadius: 8,
              padding: "16px 20px", display: "flex", gap: 32,
            }}>
              <div>
                <div style={{ fontSize: 10, color: c.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Initial scope</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: MONO }}>{s.initialScope}{u}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: c.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Final scope</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: MONO }}>{s.finalScope}{u}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: c.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Change</div>
                <div style={{
                  fontSize: 18, fontWeight: 700, fontFamily: MONO,
                  color: s.scopeChange > 0 ? c.red : s.scopeChange < 0 ? c.green : c.textMuted,
                }}>
                  {s.scopeChange > 0 ? "+" : ""}{s.scopeChange}%
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Burndown data (simple table) */}
        {s.burndown && s.burndown.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: c.textSecondary, marginBottom: 10 }}>Daily burndown</div>
            <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
              <div style={{
                display: "grid", gridTemplateColumns: "80px 80px 80px 80px 1fr",
                gap: 8, padding: "8px 16px", fontSize: 10, fontWeight: 600,
                color: c.textMuted, textTransform: "uppercase", letterSpacing: 0.5,
                borderBottom: `1px solid ${c.border}`,
              }}>
                <span>Date</span>
                <span>Scope</span>
                <span>Done</span>
                <span>Remaining</span>
                <span></span>
              </div>
              {s.burndown.map((day, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "80px 80px 80px 80px 1fr",
                  gap: 8, padding: "6px 16px", fontSize: 12, fontFamily: MONO,
                  borderBottom: `1px solid ${c.divider}`, alignItems: "center",
                }}>
                  <span style={{ color: c.textMuted }}>{day.label}</span>
                  <span style={{ color: c.textSecondary }}>{day.scope}{u}</span>
                  <span style={{ color: c.green }}>{day.completed}{u}</span>
                  <span>{day.remaining}{u}</span>
                  <div style={{ height: 4, background: c.barTrack, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{
                      width: `${day.scope > 0 ? ((day.scope - day.remaining) / day.scope) * 100 : 0}%`,
                      height: "100%", borderRadius: 2, background: c.green, opacity: 0.6,
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ textAlign: "center", padding: "20px 0", fontSize: 11, color: c.textDim }}>
          Generated by <a href="https://capacycle.com" style={{ color: c.accent, textDecoration: "none" }}>Capacycle</a> &middot; Capacity planning for Linear
        </div>
      </div>
    </div>
  );
}

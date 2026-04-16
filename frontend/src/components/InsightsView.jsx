import React, { useState, useEffect, useCallback } from "react";
import { linearQuery, ISSUE_HISTORY_QUERY, fetchCycleIssues } from "../api.js";
import { useTheme } from "../theme.jsx";
import { flatIssues, priorityLabel, statusIcon, statusColor } from "../utils.js";
import { useUnit } from "../useUnit.js";

const MONO = "'JetBrains Mono', 'SF Mono', monospace";
const SANS = "'DM Sans', system-ui, sans-serif";

function analyzeHistory(history, cycleStartsAt) {
  const cycleStart = cycleStartsAt ? new Date(cycleStartsAt) : null;
  const entries = [...(history || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  let startedAt = null;
  for (const e of entries) {
    if (e.toState?.type === "started" && e.fromState?.type !== "started") {
      startedAt = new Date(e.createdAt);
      break;
    }
  }

  const estimateChanges = entries.filter((e) => e.fromEstimate != null || e.toEstimate != null);
  let originalEstimate = null;

  for (const e of estimateChanges) {
    if (originalEstimate === null) {
      if (e.fromEstimate != null) {
        originalEstimate = e.fromEstimate;
      } else if (e.toEstimate != null) {
        originalEstimate = e.toEstimate;
        continue;
      }
    }
  }

  return { originalEstimate, startedAt };
}

// --- Progress Panel ---

function ProgressPanel({ issues, c, u }) {
  // Group issues by project, then by milestone within project
  const byProject = {};
  const allFlat = flatIssues(issues);

  for (const issue of allFlat) {
    const projKey = issue.projectId || "__none__";
    const projName = issue.projectName || "No project";
    if (!byProject[projKey]) byProject[projKey] = { name: projName, slugId: issue.projectSlugId, issues: [], milestones: {} };
    byProject[projKey].issues.push(issue);

    if (issue.milestoneId) {
      if (!byProject[projKey].milestones[issue.milestoneId]) {
        byProject[projKey].milestones[issue.milestoneId] = { name: issue.milestoneName, issues: [] };
      }
      byProject[projKey].milestones[issue.milestoneId].issues.push(issue);
    }
  }

  const projectStats = Object.entries(byProject).map(([id, proj]) => {
    const total = proj.issues.reduce((s, i) => s + (i.estimate || 0), 0);
    const done = proj.issues.filter((i) => i.stateType === "completed").reduce((s, i) => s + (i.estimate || 0), 0);
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    const milestoneStats = Object.entries(proj.milestones).map(([msId, ms]) => {
      const msTotal = ms.issues.reduce((s, i) => s + (i.estimate || 0), 0);
      const msDone = ms.issues.filter((i) => i.stateType === "completed").reduce((s, i) => s + (i.estimate || 0), 0);
      const msPct = msTotal > 0 ? Math.round((msDone / msTotal) * 100) : 0;
      return { id: msId, name: ms.name, total: msTotal, done: msDone, pct: msPct, count: ms.issues.length };
    }).sort((a, b) => b.pct - a.pct);

    return { id, name: proj.name, slugId: proj.slugId, total, done, pct, count: proj.issues.length, milestones: milestoneStats };
  }).filter((p) => p.total > 0).sort((a, b) => b.pct - a.pct);

  if (projectStats.length === 0) {
    return <div style={{ textAlign: "center", padding: 20, color: c.textMuted, fontSize: 13 }}>No project data in this cycle.</div>;
  }

  // Overall cycle stats for comparison
  const cycleTotal = allFlat.reduce((s, i) => s + (i.estimate || 0), 0);
  const cycleDone = allFlat.filter((i) => i.stateType === "completed").reduce((s, i) => s + (i.estimate || 0), 0);
  const cyclePct = cycleTotal > 0 ? Math.round((cycleDone / cycleTotal) * 100) : 0;

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: c.textSecondary, marginBottom: 4 }}>Progress by project</div>
      <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 12 }}>
        Cycle average: <span style={{ fontFamily: MONO, color: c.accent }}>{cyclePct}%</span> completed ({cycleDone}/{cycleTotal}h)
      </div>

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 70px 60px 60px",
          gap: 8, padding: "8px 16px", fontSize: 10, fontWeight: 600,
          color: c.textMuted, textTransform: "uppercase", letterSpacing: 0.5,
          borderBottom: `1px solid ${c.border}`,
        }}>
          <span>Project / Milestone</span>
          <span>Points</span>
          <span></span>
          <span>Done</span>
        </div>

        {projectStats.map((proj) => (
          <React.Fragment key={proj.id}>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 70px 60px 60px",
              gap: 8, padding: "10px 16px", fontSize: 13,
              borderBottom: `1px solid ${c.divider}`, alignItems: "center",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 600 }}>{proj.name}</span>
                <span style={{ fontSize: 10, color: c.textDim, fontFamily: MONO }}>{proj.count} issues</span>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 12 }}>
                <span style={{ color: c.green }}>{proj.done}</span>
                <span style={{ color: c.textDim }}>/</span>
                <span style={{ color: c.textSecondary }}>{proj.total}{u}</span>
              </div>
              <div>
                <div style={{ height: 6, background: c.barTrack, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${proj.pct}%`, height: "100%", borderRadius: 3, background: proj.pct >= cyclePct ? c.green : c.yellow, opacity: 0.8 }} />
                </div>
              </div>
              <span style={{
                fontFamily: MONO, fontSize: 12,
                color: proj.pct >= cyclePct ? c.green : proj.pct < cyclePct - 20 ? c.red : c.textSecondary,
                fontWeight: proj.pct >= cyclePct ? 700 : 400,
              }}>{proj.pct}%</span>
            </div>

            {proj.milestones.map((ms) => (
              <div key={ms.id} style={{
                display: "grid", gridTemplateColumns: "1fr 70px 60px 60px",
                gap: 8, padding: "8px 16px 8px 36px", fontSize: 12,
                borderBottom: `1px solid ${c.divider}`, alignItems: "center",
                color: c.textSecondary,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: c.textDim }}>&#8627;</span>
                  <span>{ms.name}</span>
                  <span style={{ fontSize: 10, color: c.textDim, fontFamily: MONO }}>{ms.count}</span>
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11 }}>
                  <span style={{ color: c.green }}>{ms.done}</span>
                  <span style={{ color: c.textDim }}>/</span>
                  <span>{ms.total}{u}</span>
                </div>
                <div>
                  <div style={{ height: 4, background: c.barTrack, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${ms.pct}%`, height: "100%", borderRadius: 2, background: ms.pct >= cyclePct ? c.green : c.yellow, opacity: 0.7 }} />
                  </div>
                </div>
                <span style={{ fontFamily: MONO, fontSize: 11, color: ms.pct >= cyclePct ? c.green : c.textMuted }}>{ms.pct}%</span>
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// --- Drift Ranking Panel ---

function DriftRankingPanel({ issues, historyMap, cycleStartsAt, c, u }) {
  const allFlat = flatIssues(issues);

  // Compute per-issue drift
  const issueDrifts = allFlat.map((issue) => {
    const analysis = analyzeHistory(historyMap[issue.id], cycleStartsAt);
    const orig = analysis.originalEstimate;
    const curr = issue.estimate;
    let drift = 0;
    if (orig != null && curr != null && orig > 0) {
      drift = ((curr - orig) / orig) * 100;
    }
    return { ...issue, drift, originalEstimate: orig };
  });

  // Group by project
  const byProject = {};
  for (const issue of issueDrifts) {
    const key = issue.projectId || "__none__";
    const name = issue.projectName || "No project";
    if (!byProject[key]) byProject[key] = { name, issues: [], milestones: {} };
    byProject[key].issues.push(issue);

    if (issue.milestoneId) {
      if (!byProject[key].milestones[issue.milestoneId]) {
        byProject[key].milestones[issue.milestoneId] = { name: issue.milestoneName, issues: [] };
      }
      byProject[key].milestones[issue.milestoneId].issues.push(issue);
    }
  }

  function computeGroupDrift(groupIssues) {
    const withEstimates = groupIssues.filter((i) => i.originalEstimate != null && i.estimate != null);
    if (withEstimates.length === 0) return { avgDrift: 0, totalOrig: 0, totalCurr: 0, driftedCount: 0, count: groupIssues.length };
    const totalOrig = withEstimates.reduce((s, i) => s + (i.originalEstimate || 0), 0);
    const totalCurr = withEstimates.reduce((s, i) => s + (i.estimate || 0), 0);
    const drifted = withEstimates.filter((i) => i.drift !== 0);
    const avgDrift = totalOrig > 0 ? ((totalCurr - totalOrig) / totalOrig) * 100 : 0;
    return { avgDrift: Math.round(avgDrift), totalOrig, totalCurr, driftedCount: drifted.length, count: groupIssues.length };
  }

  const projectDrifts = Object.entries(byProject).map(([id, proj]) => {
    const stats = computeGroupDrift(proj.issues);
    const milestoneStats = Object.entries(proj.milestones).map(([msId, ms]) => ({
      id: msId, name: ms.name, ...computeGroupDrift(ms.issues),
    })).sort((a, b) => Math.abs(b.avgDrift) - Math.abs(a.avgDrift));
    return { id, name: proj.name, ...stats, milestones: milestoneStats };
  }).filter((p) => p.count > 0).sort((a, b) => Math.abs(b.avgDrift) - Math.abs(a.avgDrift));

  if (projectDrifts.length === 0) {
    return <div style={{ textAlign: "center", padding: 20, color: c.textMuted, fontSize: 13 }}>No estimate history available.</div>;
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: c.textSecondary, marginBottom: 4 }}>Estimate drift by project</div>
      <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 12 }}>
        Sorted by absolute drift. Compares original estimates to current.
      </div>

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 80px 80px 70px 1fr",
          gap: 8, padding: "8px 16px", fontSize: 10, fontWeight: 600,
          color: c.textMuted, textTransform: "uppercase", letterSpacing: 0.5,
          borderBottom: `1px solid ${c.border}`,
        }}>
          <span>Project / Milestone</span>
          <span>Original</span>
          <span>Current</span>
          <span>Drift</span>
          <span></span>
        </div>

        {projectDrifts.map((proj) => (
          <React.Fragment key={proj.id}>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 80px 80px 70px 1fr",
              gap: 8, padding: "10px 16px", fontSize: 13,
              borderBottom: `1px solid ${c.divider}`, alignItems: "center",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 600 }}>{proj.name}</span>
                {proj.driftedCount > 0 && (
                  <span style={{ fontSize: 10, color: c.textDim, fontFamily: MONO }}>{proj.driftedCount} drifted</span>
                )}
              </div>
              <span style={{ fontFamily: MONO, fontSize: 12, color: c.textMuted }}>{proj.totalOrig}{u}</span>
              <span style={{ fontFamily: MONO, fontSize: 12, color: c.textSecondary }}>{proj.totalCurr}{u}</span>
              <span style={{
                fontFamily: MONO, fontSize: 12, fontWeight: 700,
                color: proj.avgDrift > 0 ? c.red : proj.avgDrift < 0 ? c.green : c.textMuted,
              }}>
                {proj.avgDrift > 0 ? "+" : ""}{proj.avgDrift}%
              </span>
              <div style={{ height: 6, background: c.barTrack, borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                  width: `${Math.min(Math.abs(proj.avgDrift), 100)}%`,
                  height: "100%", borderRadius: 3,
                  background: proj.avgDrift > 0 ? c.red : c.green,
                  opacity: 0.6,
                }} />
              </div>
            </div>

            {proj.milestones.map((ms) => (
              <div key={ms.id} style={{
                display: "grid", gridTemplateColumns: "1fr 80px 80px 70px 1fr",
                gap: 8, padding: "8px 16px 8px 36px", fontSize: 12,
                borderBottom: `1px solid ${c.divider}`, alignItems: "center",
                color: c.textSecondary,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: c.textDim }}>&#8627;</span>
                  <span>{ms.name}</span>
                </div>
                <span style={{ fontFamily: MONO, fontSize: 11, color: c.textMuted }}>{ms.totalOrig}{u}</span>
                <span style={{ fontFamily: MONO, fontSize: 11 }}>{ms.totalCurr}{u}</span>
                <span style={{
                  fontFamily: MONO, fontSize: 11,
                  color: ms.avgDrift > 0 ? c.red : ms.avgDrift < 0 ? c.green : c.textMuted,
                }}>
                  {ms.avgDrift > 0 ? "+" : ""}{ms.avgDrift}%
                </span>
                <div style={{ height: 4, background: c.barTrack, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{
                    width: `${Math.min(Math.abs(ms.avgDrift), 100)}%`,
                    height: "100%", borderRadius: 2,
                    background: ms.avgDrift > 0 ? c.red : c.green,
                    opacity: 0.5,
                  }} />
                </div>
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// --- Drift Patterns Panel ---

function DriftPatternsPanel({ issues, historyMap, cycleStartsAt, c }) {
  const allFlat = flatIssues(issues);

  // Compute per-issue drift
  const issueDrifts = allFlat.map((issue) => {
    const analysis = analyzeHistory(historyMap[issue.id], cycleStartsAt);
    const orig = analysis.originalEstimate;
    const curr = issue.estimate;
    let drift = 0;
    let absDrift = 0;
    if (orig != null && curr != null && orig > 0) {
      drift = ((curr - orig) / orig) * 100;
      absDrift = Math.abs(drift);
    }
    return { ...issue, drift, absDrift, originalEstimate: orig };
  });

  const withDrift = issueDrifts.filter((i) => i.absDrift > 0);
  const noDrift = issueDrifts.filter((i) => i.absDrift === 0 && i.originalEstimate != null);

  if (withDrift.length < 2) {
    return <div style={{ textAlign: "center", padding: 20, color: c.textMuted, fontSize: 13 }}>Need at least 2 drifted issues to detect patterns.</div>;
  }

  const avgDrift = withDrift.reduce((s, i) => s + i.absDrift, 0) / withDrift.length;

  // Analyze by dimension
  function analyzeByDimension(keyFn, labelFn) {
    const groups = {};
    for (const issue of issueDrifts) {
      if (issue.originalEstimate == null) continue;
      const keys = keyFn(issue);
      for (const key of (Array.isArray(keys) ? keys : [keys])) {
        if (!key) continue;
        if (!groups[key]) groups[key] = { label: labelFn ? labelFn(key, issue) : key, drifted: [], stable: [] };
        if (issue.absDrift > 0) groups[key].drifted.push(issue);
        else groups[key].stable.push(issue);
      }
    }

    return Object.values(groups)
      .filter((g) => g.drifted.length + g.stable.length >= 2)
      .map((g) => {
        const total = g.drifted.length + g.stable.length;
        const driftRate = total > 0 ? (g.drifted.length / total) * 100 : 0;
        const avgGroupDrift = g.drifted.length > 0
          ? g.drifted.reduce((s, i) => s + i.absDrift, 0) / g.drifted.length
          : 0;
        return { ...g, total, driftRate: Math.round(driftRate), avgDrift: Math.round(avgGroupDrift) };
      })
      .sort((a, b) => b.avgDrift - a.avgDrift);
  }

  // By label
  const byLabel = analyzeByDimension(
    (i) => i.labels.map((l) => l.name),
    (key) => key,
  );

  // By priority
  const byPriority = analyzeByDimension(
    (i) => [i.priority > 0 ? String(i.priority) : null],
    (key) => priorityLabel(parseInt(key)) || `P${key}`,
  );

  // By estimate size bucket
  const sizeBucket = (est) => {
    if (est == null) return null;
    if (est <= 1) return "small";
    if (est <= 3) return "medium";
    if (est <= 5) return "large";
    return "xlarge";
  };
  const sizeLabels = { small: "Small (0-1h)", medium: "Medium (2-3h)", large: "Large (4-5h)", xlarge: "XL (5h+)" };
  const bySize = analyzeByDimension(
    (i) => [sizeBucket(i.originalEstimate || i.estimate)],
    (key) => sizeLabels[key] || key,
  );

  // By assignee
  const byAssignee = analyzeByDimension(
    (i) => [i.assigneeName !== "Unassigned" ? i.assigneeName : null],
    (key) => key,
  );

  function PatternTable({ title, data }) {
    if (data.length === 0) return null;
    // Only show groups where drift rate or avg drift is notably different from baseline
    const baselineDriftRate = issueDrifts.filter((i) => i.originalEstimate != null).length > 0
      ? (withDrift.length / issueDrifts.filter((i) => i.originalEstimate != null).length) * 100 : 0;

    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: c.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</div>
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
          {data.map((g, i) => {
            const isHigh = g.avgDrift > avgDrift * 1.3 || g.driftRate > baselineDriftRate + 15;
            return (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "1fr 60px 80px 80px 1fr",
                gap: 8, padding: "8px 16px", fontSize: 12,
                borderBottom: `1px solid ${c.divider}`, alignItems: "center",
              }}>
                <span style={{ color: isHigh ? c.text : c.textSecondary, fontWeight: isHigh ? 600 : 400 }}>
                  {g.label}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: c.textMuted }}>{g.total} issues</span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: g.driftRate > baselineDriftRate + 15 ? c.red : c.textSecondary }}>
                    {g.driftRate}% drifted
                  </span>
                </div>
                <span style={{ fontFamily: MONO, fontSize: 11, color: g.avgDrift > avgDrift * 1.3 ? c.red : c.textMuted }}>
                  avg {g.avgDrift}%
                </span>
                <div style={{ height: 4, background: c.barTrack, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{
                    width: `${Math.min(g.avgDrift, 200) / 2}%`,
                    height: "100%", borderRadius: 2,
                    background: isHigh ? c.red : c.accent,
                    opacity: 0.6,
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: c.textSecondary, marginBottom: 4 }}>Drift patterns</div>
      <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 12 }}>
        What do high-drift issues have in common? Baseline:
        {" "}<span style={{ fontFamily: MONO, color: c.accent }}>{withDrift.length}/{withDrift.length + noDrift.length}</span> issues drifted,
        {" "}avg <span style={{ fontFamily: MONO, color: c.accent }}>{Math.round(avgDrift)}%</span>
      </div>

      <PatternTable title="By label" data={byLabel} />
      <PatternTable title="By estimate size" data={bySize} />
      <PatternTable title="By priority" data={byPriority} />
      <PatternTable title="By assignee" data={byAssignee} />
    </div>
  );
}

// --- Carry-Over Panel ---

function CarryOverPanel({ issues, cycle, cycles, c, u }) {
  const [carryOvers, setCarryOvers] = useState(null);
  const [loading, setLoading] = useState(false);

  const currentIssues = flatIssues(issues);
  const currentIds = new Set(currentIssues.map((i) => i.id));

  useEffect(() => {
    if (!cycle || !cycles || cycles.length < 2) return;

    const currentIdx = cycles.findIndex((cy) => cy.id === cycle.id);
    if (currentIdx <= 0) return;

    // Fetch issues from the previous 3 cycles (or fewer if not enough)
    const prevCycles = cycles.slice(Math.max(0, currentIdx - 3), currentIdx);

    setLoading(true);
    (async () => {
      const cycleIssueMap = {};
      for (const cy of prevCycles) {
        try {
          const data = await fetchCycleIssues(cy.id);
          const nodes = data.cycle?.issues?.nodes || [];
          cycleIssueMap[cy.id] = new Set(nodes.map((n) => n.id));
        } catch {
          cycleIssueMap[cy.id] = new Set();
        }
      }

      // For each current issue, count how many previous cycles it appeared in
      const issueHistory = currentIssues.map((issue) => {
        const appearedIn = prevCycles.filter((cy) => cycleIssueMap[cy.id].has(issue.id));
        return { issue, cyclesAppeared: appearedIn.length, cycleNumbers: appearedIn.map((cy) => cy.number) };
      }).filter((i) => i.cyclesAppeared > 0)
        .sort((a, b) => b.cyclesAppeared - a.cyclesAppeared);

      setCarryOvers(issueHistory);
      setLoading(false);
    })();
  }, [cycle?.id, cycles?.length]);

  if (loading) {
    return <div style={{ textAlign: "center", padding: 30, color: c.textMuted, fontSize: 13 }}>Analyzing previous cycles...</div>;
  }

  if (!carryOvers || carryOvers.length === 0) {
    return <div style={{ textAlign: "center", padding: 30, color: c.textMuted, fontSize: 13 }}>No carry-over issues found in this cycle.</div>;
  }

  const stillOpen = carryOvers.filter((i) => i.issue.stateType !== "completed" && i.issue.stateType !== "canceled");
  const resolved = carryOvers.filter((i) => i.issue.stateType === "completed" || i.issue.stateType === "canceled");

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: c.textSecondary, marginBottom: 4 }}>Carry-over issues</div>
      <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 12 }}>
        Issues that appeared in previous cycles and are still in this one.
        {" "}<span style={{ fontFamily: MONO, color: c.accent }}>{carryOvers.length}</span> carry-overs found,
        {" "}<span style={{ fontFamily: MONO, color: stillOpen.length > 0 ? c.red : c.green }}>{stillOpen.length}</span> still open.
      </div>

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
        <div style={{
          display: "grid", gridTemplateColumns: "20px 70px 1fr 100px 80px 60px",
          gap: 8, padding: "8px 16px", fontSize: 10, fontWeight: 600,
          color: c.textMuted, textTransform: "uppercase", letterSpacing: 0.5,
          borderBottom: `1px solid ${c.border}`,
        }}>
          <span />
          <span>ID</span>
          <span>Title</span>
          <span>Previous cycles</span>
          <span>Assignee</span>
          <span>Est.</span>
        </div>

        {carryOvers.map(({ issue, cyclesAppeared, cycleNumbers }) => (
          <div key={issue.id} style={{
            display: "grid", gridTemplateColumns: "20px 70px 1fr 100px 80px 60px",
            gap: 8, padding: "8px 16px", fontSize: 13,
            borderBottom: `1px solid ${c.divider}`, alignItems: "center",
          }}
            onMouseEnter={(e) => e.currentTarget.style.background = c.accentBg}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
          >
            <span style={{ color: statusColor(issue.stateType), fontSize: 14 }}>{statusIcon(issue.stateType)}</span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: c.textMuted }}>{issue.identifier}</span>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: c.textSecondary }}>
              {issue.title}
              {issue.projectName && (
                <span style={{
                  fontSize: 9, padding: "1px 5px", borderRadius: 3, marginLeft: 6,
                  background: `${c.textMuted}18`, color: c.textMuted,
                }}>{issue.projectName}</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 3 }}>
              {cycleNumbers.map((n) => (
                <span key={n} style={{
                  fontSize: 10, fontFamily: MONO, padding: "1px 6px",
                  borderRadius: 3, background: `${c.red}18`, color: c.red,
                }}>C{n}</span>
              ))}
            </div>
            <span style={{ fontSize: 11, color: c.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {issue.assigneeName === "Unassigned" ? "—" : issue.assigneeName?.split(" ")[0]}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: c.textDim }}>
              {issue.estimate ? `${issue.estimate}${u}` : "—"}
            </span>
          </div>
        ))}
      </div>

      {stillOpen.length > 0 && (
        <div style={{ fontSize: 11, color: c.textMuted, marginTop: 8 }}>
          <span style={{ color: c.red }}>{stillOpen.length} issue{stillOpen.length > 1 ? "s" : ""}</span>
          {" "}carried over and still not completed.
          {stillOpen.some((i) => i.cyclesAppeared >= 2) && (
            <span style={{ color: c.red }}> {stillOpen.filter((i) => i.cyclesAppeared >= 2).length} appeared in 2+ previous cycles.</span>
          )}
        </div>
      )}
    </div>
  );
}

// --- Main InsightsView ---

export default function InsightsView({ issues, cycle, cycles = [], avatars = {} }) {
  const { colors: c } = useTheme();
  const u = useUnit();
  const [historyMap, setHistoryMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [activePanel, setActivePanel] = useState("progress");

  const allIssues = flatIssues(issues);

  const fetchAllHistory = useCallback(async () => {
    setLoading(true);
    const map = {};
    const batchSize = 10;
    for (let i = 0; i < allIssues.length; i += batchSize) {
      const batch = allIssues.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map((issue) =>
          linearQuery(ISSUE_HISTORY_QUERY, { issueId: issue.id })
            .then((data) => ({ id: issue.id, history: data.issue.history.nodes }))
            .catch(() => ({ id: issue.id, history: [] }))
        )
      );
      results.forEach((r) => { map[r.id] = r.history; });
    }
    setHistoryMap(map);
    setLoading(false);
    setLoaded(true);
  }, [allIssues.map((i) => i.id).join(",")]);

  const issueFingerprint = allIssues.map((i) => `${i.id}:${i.estimate}:${i.stateType}`).join(",");

  useEffect(() => {
    setLoaded(false);
    setHistoryMap({});
  }, [cycle?.id, issueFingerprint]);

  useEffect(() => {
    if (!loaded && allIssues.length > 0) fetchAllHistory();
  }, [fetchAllHistory, loaded, allIssues.length]);

  const hasHistory = loaded && Object.keys(historyMap).length > 0;

  const panels = [
    { id: "progress", label: "Progress" },
    { id: "drift", label: "Drift ranking" },
    { id: "patterns", label: "Patterns" },
    { id: "carryover", label: "Carry-over" },
  ];

  return (
    <div>
      {/* Sub-navigation */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {panels.map((p) => (
          <button key={p.id} onClick={() => setActivePanel(p.id)} style={{
            background: activePanel === p.id ? c.accentBg : "transparent",
            border: `1px solid ${activePanel === p.id ? c.accent : c.border}`,
            borderRadius: 5, padding: "5px 14px", fontSize: 12,
            color: activePanel === p.id ? c.accent : c.textMuted,
            cursor: "pointer", fontFamily: SANS, fontWeight: activePanel === p.id ? 600 : 400,
          }}>{p.label}</button>
        ))}
        {loading && <span style={{ fontSize: 11, color: c.textMuted, lineHeight: "28px", marginLeft: 8 }}>Loading history...</span>}
      </div>

      {activePanel === "progress" && (
        <ProgressPanel issues={issues} c={c} u={u} />
      )}

      {activePanel === "drift" && (
        hasHistory
          ? <DriftRankingPanel issues={issues} historyMap={historyMap} cycleStartsAt={cycle?.startsAt} c={c} u={u} />
          : loading
            ? <div style={{ textAlign: "center", padding: 30, color: c.textMuted, fontSize: 13 }}>Loading estimate history...</div>
            : <div style={{ textAlign: "center", padding: 30, color: c.textMuted, fontSize: 13 }}>No issues to analyze.</div>
      )}

      {activePanel === "patterns" && (
        hasHistory
          ? <DriftPatternsPanel issues={issues} historyMap={historyMap} cycleStartsAt={cycle?.startsAt} c={c} />
          : loading
            ? <div style={{ textAlign: "center", padding: 30, color: c.textMuted, fontSize: 13 }}>Loading estimate history...</div>
            : <div style={{ textAlign: "center", padding: 30, color: c.textMuted, fontSize: 13 }}>No issues to analyze.</div>
      )}

      {activePanel === "carryover" && (
        <CarryOverPanel issues={issues} cycle={cycle} cycles={cycles} c={c} u={u} />
      )}
    </div>
  );
}

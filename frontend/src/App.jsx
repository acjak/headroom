import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";
import {
  fetchTeams, fetchTeamData, fetchCycleIssues, fetchBacklogIssues,
  refreshServerCache, linearQuery, ISSUE_HISTORY_QUERY,
} from "./api.js";
import {
  pickActiveCycle, groupByAssignee, enrichIssues, flatIssues,
  loadCapacities, saveCapacities, loadAvailability, computeCapacities, formatDate,
} from "./utils.js";
import { useTheme } from "./theme.jsx";
import { useAuth } from "./AuthContext.jsx";
import BurndownChart from "./components/BurndownChart.jsx";
import CapacityBar from "./components/CapacityBar.jsx";
import PersonCard from "./components/PersonCard.jsx";
import AvailabilityCalendar from "./components/AvailabilityCalendar.jsx";
import VelocityChart from "./components/VelocityChart.jsx";
import KanbanBoard from "./components/KanbanBoard.jsx";
import EstimatesView from "./components/EstimatesView.jsx";
import Logo from "./components/Logo.jsx";
import DataFreshness from "./components/DataFreshness.jsx";
import DriftTrends from "./components/DriftTrends.jsx";
import CompletionEstimates from "./components/CompletionEstimates.jsx";
import {
  IconInsights, IconForecast, IconShare, IconCapacity, IconBurndown,
  IconVelocity, IconEstimates, IconBoard, IconEdit, IconCollapse, IconExpand,
} from "./icons.jsx";
import InsightsView from "./components/InsightsView.jsx";

const MONO = "'JetBrains Mono', 'SF Mono', monospace";
const SANS = "'DM Sans', system-ui, sans-serif";

export default function App({ demo = false }) {
  const { colors, mode, toggle, fontScale, setFontScale, fontSizeLabel, fontScales } = useTheme();
  const { auth, logout, showPlanSelection, updateSettings } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [step, setStep] = useState("Loading...");

  const [teams, setTeams] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [cycles, setCycles] = useState([]);
  const [activeCycle, setActiveCycle] = useState(null);
  const [issues, setIssues] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [people, setPeople] = useState([]);
  const [capacities, setCapacities] = useState({});
  const [showSettings, setShowSettings] = useState(false);
  const [burndownMode, setBurndownMode] = useState("hours");
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem("activeTab") || "capacity");
  const [allExpanded, setAllExpanded] = useState(true);
  const [avatars, setAvatars] = useState({});
  const [showForecasting, setShowForecasting] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareNote, setShareNote] = useState("");
  const [shareLink, setShareLink] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);

  // Live update listener
  const selectedTeamRef = useRef(null);
  const activeCycleRef = useRef(null);

  useEffect(() => {
    if (demo) return; // No live updates in demo mode
    const socket = io({ transports: ["websocket", "polling"] });
    let debounceTimer = null;

    socket.on("data-updated", () => {
      // Debounce rapid webhook events
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (selectedTeamRef.current) {
          loadTeamSilent(selectedTeamRef.current);
        }
      }, 1000);
    });

    return () => { clearTimeout(debounceTimer); socket.disconnect(); };
  }, [demo]);

  // Silent reload — no loading spinner, just updates data in background
  const loadTeamSilent = useCallback(async (team) => {
    try {
      const data = await fetchTeamData(team.id);
      const t = data.team;
      const allCycles = (t.cycles.nodes || []).sort((a, b) => a.number - b.number);
      setCycles(allCycles);

      // Update activeCycle to the fresh version (with updated scopeHistory etc.)
      // so the burndown and velocity charts receive new data.
      const currentActive = activeCycleRef.current;
      if (currentActive) {
        const refreshed = allCycles.find((c) => c.id === currentActive.id);
        if (refreshed) setActiveCycle(refreshed);
      }

      const cycle = activeCycleRef.current;
      let issueNodes = [];
      if (cycle) {
        const iData = await fetchCycleIssues(cycle.id);
        issueNodes = iData.cycle.issues.nodes;
      } else {
        const iData = await fetchBacklogIssues(team.id);
        issueNodes = iData.team.issues.nodes;
      }

      const enriched = enrichIssues(issueNodes);
      setIssues(enriched);

      const memberNodes = t.members?.nodes || [];
      const members = memberNodes.map((m) => m.name || m.displayName);
      setTeamMembers(members);
      const allFlat = flatIssues(enriched);
      const fromIssues = allFlat.map((i) => i.assigneeName).filter((n) => n !== "Unassigned");
      const uniq = [...new Set([...members, ...fromIssues])];
      setPeople(uniq);
    } catch {}
  }, []);

  // Initial load: fetch teams
  useEffect(() => {
    (async () => {
      try {
        setStep("Fetching teams...");
        const data = await fetchTeams();
        let nodes = data.teams.nodes;
        // Filter by accessible teams if subscription limits access
        const accessible = auth?.billing?.accessibleTeams;
        if (Array.isArray(accessible)) {
          nodes = nodes.filter((t) => accessible.includes(t.id));
        }
        setTeams(nodes);
        const savedId = localStorage.getItem("selectedTeamId");
        const saved = savedId && nodes.find((t) => t.id === savedId);
        if (saved) setSelectedTeam(saved);
        else if (nodes.length === 1) setSelectedTeam(nodes[0]);
        if (nodes.length === 0) setError("No teams found in Linear workspace");
      } catch (e) {
        setError("Failed to connect: " + e.message);
      }
      setLoading(false);
    })();
  }, []);

  // Load team data
  const loadTeam = useCallback(async (team) => {
    setLoading(true);
    setError(null);
    try {
      setStep("Loading team data...");
      const data = await fetchTeamData(team.id);
      const t = data.team;
      const allCycles = (t.cycles.nodes || []).sort((a, b) => a.number - b.number);
      setCycles(allCycles);

      const memberNodes = t.members?.nodes || [];
      const members = memberNodes.map((m) => m.name || m.displayName);
      setTeamMembers(members);
      const avMap = {};
      memberNodes.forEach((m) => { if (m.avatarUrl) avMap[m.name || m.displayName] = m.avatarUrl; });

      const picked = pickActiveCycle(allCycles);
      setActiveCycle(picked);

      setStep("Loading issues...");
      let issueNodes = [];
      if (picked) {
        const iData = await fetchCycleIssues(picked.id);
        issueNodes = iData.cycle.issues.nodes;
      } else {
        const iData = await fetchBacklogIssues(team.id);
        issueNodes = iData.team.issues.nodes;
      }

      const enriched = enrichIssues(issueNodes);
      setIssues(enriched);

      const allFlat = flatIssues(enriched);
      allFlat.forEach((i) => { if (i.avatarUrl) avMap[i.assigneeName] = i.avatarUrl; });
      setAvatars(avMap);
      const fromIssues = allFlat.map((i) => i.assigneeName).filter((n) => n !== "Unassigned");
      const uniq = [...new Set([...members, ...fromIssues])];
      setPeople(uniq);

      if (picked) {
        const avail = await loadAvailability(team.id, picked.id);
        setCapacities(computeCapacities(avail, uniq, picked.startsAt, picked.endsAt));
      } else {
        const saved = loadCapacities(team.id);
        const caps = { ...saved };
        uniq.forEach((p) => { if (!(p in caps)) caps[p] = 15; });
        setCapacities(caps);
      }
    } catch (e) {
      setError("Failed: " + e.message);
    }
    setLoading(false);
  }, []);

  const loadCycleIssues = useCallback(async (cycle) => {
    if (!cycle || !selectedTeam) return;
    setLoading(true);
    try {
      const iData = await fetchCycleIssues(cycle.id);
      const enriched = enrichIssues(iData.cycle.issues.nodes);
      setIssues(enriched);
      const allFlat = flatIssues(enriched);
      const fromIssues = allFlat.map((i) => i.assigneeName).filter((n) => n !== "Unassigned");
      const uniq = [...new Set([...teamMembers, ...fromIssues])];
      setPeople(uniq);
      const avail = await loadAvailability(selectedTeam.id, cycle.id);
      setCapacities(computeCapacities(avail, uniq, cycle.startsAt, cycle.endsAt));
    } catch (e) {
      setError("Failed: " + e.message);
    }
    setLoading(false);
  }, [selectedTeam, teamMembers]);

  useEffect(() => {
    if (selectedTeam) {
      selectedTeamRef.current = selectedTeam;
      localStorage.setItem("selectedTeamId", selectedTeam.id);
      loadTeam(selectedTeam);
    }
  }, [selectedTeam, loadTeam]);

  useEffect(() => {
    activeCycleRef.current = activeCycle;
  }, [activeCycle]);

  const handleRefresh = async () => {
    await refreshServerCache();
    if (selectedTeam) loadTeam(selectedTeam);
  };

  const switchTab = (tab) => { setActiveTab(tab); localStorage.setItem("activeTab", tab); };

  const switchCycle = (c) => {
    setActiveCycle(c);
    loadCycleIssues(c);
  };

  // Unit setting: "points" or "hours" (default "hours")
  const unit = (auth && typeof auth === "object" && auth.settings?.unit) || "hours";
  const u = unit === "points" ? "p" : "h";

  const byPerson = groupByAssignee(issues, people);
  const allFlat = flatIssues(issues);
  const totalPts = allFlat.reduce((s, i) => s + (i.estimate || 0), 0);
  const totalCap = people.reduce((s, p) => s + (capacities[p] || 0), 0);
  const donePts = allFlat.filter((i) => i.stateType === "completed").reduce((s, i) => s + (i.estimate || 0), 0);
  const unestCount = allFlat.filter((i) => !i.estimate).length;
  const pctDone = totalPts > 0 ? Math.round((donePts / totalPts) * 100) : 0;

  const handleShareReport = async () => {
    if (!selectedTeam || !activeCycle) return;
    setShareLoading(true);
    try {
      // Build per-project progress snapshot
      const projectMap = {};
      for (const issue of allFlat) {
        const key = issue.projectId || "__none__";
        const name = issue.projectName || "No project";
        if (!projectMap[key]) projectMap[key] = { name, issues: [], milestones: {} };
        projectMap[key].issues.push(issue);
        if (issue.milestoneId) {
          if (!projectMap[key].milestones[issue.milestoneId]) {
            projectMap[key].milestones[issue.milestoneId] = { name: issue.milestoneName, issues: [] };
          }
          projectMap[key].milestones[issue.milestoneId].issues.push(issue);
        }
      }
      const projects = Object.values(projectMap).map((proj) => {
        const total = proj.issues.reduce((s, i) => s + (i.estimate || 0), 0);
        const done = proj.issues.filter((i) => i.stateType === "completed").reduce((s, i) => s + (i.estimate || 0), 0);
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const milestones = Object.values(proj.milestones).map((ms) => {
          const msTotal = ms.issues.reduce((s, i) => s + (i.estimate || 0), 0);
          const msDone = ms.issues.filter((i) => i.stateType === "completed").reduce((s, i) => s + (i.estimate || 0), 0);
          return { name: ms.name, total: msTotal, done: msDone, pct: msTotal > 0 ? Math.round((msDone / msTotal) * 100) : 0 };
        });
        return { name: proj.name, total, done, pct, milestones };
      }).filter((p) => p.total > 0).sort((a, b) => b.pct - a.pct);

      // Build burndown snapshot from cycle history
      const scope = activeCycle.scopeHistory || [];
      const completed = activeCycle.completedScopeHistory || [];
      const burndown = [];
      const start = new Date(activeCycle.startsAt);
      for (let i = 0; i < scope.length; i++) {
        const d = new Date(start.getTime() + i * 86400000);
        burndown.push({
          label: formatDate(d),
          scope: scope[i] || 0,
          completed: completed[i] || 0,
          remaining: Math.max(0, (scope[i] || 0) - (completed[i] || 0)),
        });
      }

      // Scope change
      const initialScope = scope[0] || 0;
      const finalScope = scope[scope.length - 1] || 0;
      const scopeChange = initialScope > 0 ? Math.round(((finalScope - initialScope) / initialScope) * 100) : null;

      const snapshot = {
        teamName: selectedTeam.name,
        cycleNumber: activeCycle.number,
        cycleStart: activeCycle.startsAt,
        cycleEnd: activeCycle.endsAt,
        unit,
        issueCount: issues.length,
        totalPts,
        donePts,
        pctDone,
        totalCap,
        unestCount,
        projects,
        burndown,
        initialScope,
        finalScope,
        scopeChange,
      };

      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: selectedTeam.id,
          cycleId: activeCycle.id,
          snapshot,
          note: shareNote || null,
        }),
      });
      const data = await res.json();
      if (data.token) {
        setShareLink(`${window.location.origin}/report/${data.token}`);
      }
    } catch (err) {
      console.error("Failed to create report:", err);
    }
    setShareLoading(false);
  };

  const c = colors;

  return (
    <div style={{ fontFamily: SANS, background: c.bg, color: c.text, minHeight: "100vh", padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>

      {/* Demo banner */}
      {demo && (
        <div style={{
          background: c.accentBg, border: `1px solid ${c.accent}`, borderRadius: 8,
          padding: "10px 16px", marginBottom: 14, display: "flex",
          justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: 13, color: c.text }}>
            You're viewing a demo with sample data.
          </span>
          <a href="/" onClick={(e) => { e.preventDefault(); window.history.pushState({}, "", "/"); window.location.reload(); }} style={{
            background: c.accent, color: "#fff", border: "none", borderRadius: 6,
            padding: "5px 14px", fontSize: 12, fontWeight: 600,
            cursor: "pointer", fontFamily: SANS, textDecoration: "none",
          }}>
            Get started
          </a>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: -0.3, display: "flex", alignItems: "center", gap: 8 }}><Logo size={22} /> Capacycle</h1>
          <div style={{ fontSize: 11, color: c.textMuted, marginTop: 2, fontFamily: MONO }}>
            {selectedTeam?.name || "Select team"}
            {activeCycle && ` \u00B7 Cycle ${activeCycle.number}`}
            {activeCycle && ` \u00B7 ${formatDate(activeCycle.startsAt)} \u2013 ${formatDate(activeCycle.endsAt)}`}
            {!activeCycle && selectedTeam && !loading && " \u00B7 No active cycle"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {teams.length > 1 && (
            <select value={selectedTeam?.id || ""}
              onChange={(e) => { const t = teams.find((t) => t.id === e.target.value); if (t) setSelectedTeam(t); }}
              style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 6, padding: "5px 8px", fontSize: 11, color: c.textSecondary, fontFamily: SANS }}>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <DataFreshness onRefresh={handleRefresh} />
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowUserMenu((m) => !m)} style={{
              display: "flex", alignItems: "center", gap: 6,
              background: c.card, border: `1px solid ${c.border}`, borderRadius: 6,
              padding: "4px 10px 4px 4px", fontSize: 11, color: c.textSecondary,
              cursor: "pointer", fontFamily: SANS,
            }}>
              {auth && auth !== "standalone" && auth.user ? (
                <>
                  {auth.user.avatarUrl ? (
                    <img src={auth.user.avatarUrl} alt="" style={{ width: 22, height: 22, borderRadius: "50%" }} />
                  ) : (
                    <div style={{ width: 22, height: 22, borderRadius: "50%", background: c.accentBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: c.accent }}>
                      {auth.user.name?.[0] || "?"}
                    </div>
                  )}
                  {auth.user.name?.split(" ")[0] || "User"}
                </>
              ) : (
                <span style={{ fontSize: 14, lineHeight: "22px" }}>{"\u2699"}</span>
              )}
              <span style={{ fontSize: 8, color: c.textDim, marginLeft: 2 }}>{"\u25BC"}</span>
            </button>
            {showUserMenu && (
              <>
                <div onClick={() => setShowUserMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }} />
                <div style={{
                  position: "absolute", right: 0, top: "100%", marginTop: 4, zIndex: 100,
                  background: c.card, border: `1px solid ${c.border}`, borderRadius: 8,
                  padding: 4, minWidth: 180, boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                }}>
                  {auth && auth !== "standalone" && auth.user && (
                    <div style={{ padding: "8px 12px", fontSize: 11, color: c.textMuted, borderBottom: `1px solid ${c.divider}` }}>
                      {auth.user.email || auth.user.name}
                    </div>
                  )}

                  {/* Theme toggle */}
                  <button onClick={() => { toggle(); }} style={{
                    display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center",
                    background: "transparent", border: "none", borderRadius: 4,
                    padding: "8px 12px", fontSize: 12, color: c.text,
                    cursor: "pointer", fontFamily: SANS,
                  }}
                    onMouseEnter={(e) => e.currentTarget.style.background = c.accentBg}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <span>Theme</span>
                    <span style={{ fontSize: 11, color: c.textMuted, fontFamily: MONO }}>{mode === "dark" ? "\u263E dark" : "\u2600 light"}</span>
                  </button>

                  {/* Font size */}
                  <div style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: c.text }}>Font size</span>
                    <div style={{ display: "flex", gap: 2 }}>
                      {fontScales.map((s) => (
                        <button key={s.label} onClick={() => setFontScale(s.value)} style={{
                          background: fontScale === s.value ? c.accentBg : "transparent",
                          border: `1px solid ${fontScale === s.value ? c.accent : "transparent"}`,
                          borderRadius: 3, padding: "2px 7px", fontSize: 11, fontFamily: MONO,
                          color: fontScale === s.value ? c.accent : c.textMuted,
                          cursor: "pointer",
                        }}>{s.label}</button>
                      ))}
                    </div>
                  </div>

                  {/* Unit setting — owner only in cloud mode */}
                  {auth && auth !== "standalone" && auth.user?.role === "owner" && (
                    <div style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: c.text }}>Estimates</span>
                      <div style={{ display: "flex", gap: 2 }}>
                        {[{ id: "hours", label: "Hours" }, { id: "points", label: "Points" }].map((opt) => (
                          <button key={opt.id} onClick={() => updateSettings({ unit: opt.id })} style={{
                            background: unit === opt.id ? c.accentBg : "transparent",
                            border: `1px solid ${unit === opt.id ? c.accent : "transparent"}`,
                            borderRadius: 3, padding: "2px 7px", fontSize: 11, fontFamily: MONO,
                            color: unit === opt.id ? c.accent : c.textMuted,
                            cursor: "pointer",
                          }}>{opt.label}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ borderTop: `1px solid ${c.divider}`, margin: "2px 0" }} />

                  {/* Manage billing — owner only */}
                  {auth && auth !== "standalone" && auth.user?.role === "owner" && (
                    <button onClick={async () => {
                      setShowUserMenu(false);
                      const res = await fetch("/api/billing/portal", { method: "POST" });
                      const data = await res.json();
                      if (data.url) window.location.href = data.url;
                    }} style={{
                      display: "block", width: "100%", textAlign: "left",
                      background: "transparent", border: "none", borderRadius: 4,
                      padding: "8px 12px", fontSize: 12, color: c.text,
                      cursor: "pointer", fontFamily: SANS,
                    }}
                      onMouseEnter={(e) => e.currentTarget.style.background = c.accentBg}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      Manage billing
                    </button>
                  )}

                  {/* Sign out — cloud mode only */}
                  {auth && auth !== "standalone" && auth.user && (
                    <button onClick={() => { setShowUserMenu(false); logout(); }} style={{
                      display: "block", width: "100%", textAlign: "left",
                      background: "transparent", border: "none", borderRadius: 4,
                      padding: "8px 12px", fontSize: 12, color: c.text,
                      cursor: "pointer", fontFamily: SANS,
                    }}
                      onMouseEnter={(e) => e.currentTarget.style.background = c.accentBg}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      Sign out
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Trial banner */}
      {auth && auth !== "standalone" && auth.billing?.status === "trialing" && auth.billing?.trialEndsAt && (() => {
        const daysLeft = Math.max(0, Math.ceil((new Date(auth.billing.trialEndsAt) - new Date()) / 86400000));
        return (
          <div style={{
            background: c.accentBg, border: `1px solid ${c.accent}`, borderRadius: 8,
            padding: "10px 16px", marginBottom: 14, display: "flex",
            justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ fontSize: 13, color: c.text }}>
              {daysLeft > 0
                ? `You're on a free trial — ${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining.`
                : "Your free trial has ended."}
            </span>
            {auth.user?.role === "owner" ? (
              <button onClick={showPlanSelection} style={{
                background: c.accent, color: "#fff", border: "none", borderRadius: 6,
                padding: "5px 14px", fontSize: 12, fontWeight: 600,
                cursor: "pointer", fontFamily: SANS,
              }}>
                Choose a plan
              </button>
            ) : (
              <span style={{ fontSize: 12, color: c.textMuted }}>
                Ask your workspace owner to subscribe.
              </span>
            )}
          </div>
        );
      })()}

      {/* Cycle pills + Forecasting toggle */}
      {!loading && selectedTeam && (
        <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          {cycles.length > 1 && cycles.map((cy) => (
            <button key={cy.id} onClick={() => { switchCycle(cy); setShowForecasting(false); setShowInsights(false); }} style={{
              background: activeCycle?.id === cy.id && !showForecasting && !showInsights ? c.accentBg : c.card,
              border: `1px solid ${activeCycle?.id === cy.id && !showForecasting && !showInsights ? c.accent : c.border}`,
              borderRadius: 5, padding: "4px 10px", fontSize: 11,
              color: activeCycle?.id === cy.id && !showForecasting && !showInsights ? c.accent : c.textMuted,
              cursor: "pointer", fontFamily: MONO,
            }}>Cycle {cy.number}</button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={() => { setShowInsights((v) => !v); setShowForecasting(false); }} style={{
            background: showInsights ? c.accent : c.card,
            border: `1px solid ${showInsights ? c.accent : c.border}`,
            borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600,
            color: showInsights ? "#fff" : c.textSecondary,
            cursor: "pointer", fontFamily: SANS, display: "inline-flex", alignItems: "center",
          }}><IconInsights style={{ marginRight: 5 }} />Insights</button>
          <button onClick={() => { setShowForecasting((f) => !f); setShowInsights(false); }} style={{
            background: showForecasting ? c.accent : c.card,
            border: `1px solid ${showForecasting ? c.accent : c.border}`,
            borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600,
            color: showForecasting ? "#fff" : c.textSecondary,
            cursor: "pointer", fontFamily: SANS, display: "inline-flex", alignItems: "center",
          }}><IconForecast style={{ marginRight: 5 }} />Forecasting</button>
          {!demo && activeCycle && (
            <button onClick={() => { setShowShareModal(true); setShareLink(null); setShareNote(""); }} style={{
              background: c.card, border: `1px solid ${c.border}`,
              borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600,
              color: c.textSecondary, cursor: "pointer", fontFamily: SANS, display: "inline-flex", alignItems: "center",
            }}><IconShare style={{ marginRight: 5 }} />Share</button>
          )}
        </div>
      )}

      {error && <div style={{ background: c.redBg, border: `1px solid ${c.redBorder}`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: c.red }}>{error}</div>}

      {/* Share report modal */}
      {showShareModal && (
        <>
          <div onClick={() => setShowShareModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200 }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            background: c.card, border: `1px solid ${c.border}`, borderRadius: 12,
            padding: "28px 32px", zIndex: 201, minWidth: 400, maxWidth: 500,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          }}>
            {!shareLink ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Share cycle report</div>
                <div style={{ fontSize: 12, color: c.textMuted, marginBottom: 16 }}>
                  Creates a snapshot of Cycle {activeCycle?.number} that anyone with the link can view.
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Note (optional)</div>
                  <textarea
                    value={shareNote}
                    onChange={(e) => setShareNote(e.target.value)}
                    placeholder="e.g. This cycle we focused on API v2..."
                    style={{
                      width: "100%", minHeight: 80, padding: "10px 12px",
                      background: c.input, border: `1px solid ${c.border}`, borderRadius: 6,
                      color: c.text, fontSize: 13, fontFamily: SANS,
                      resize: "vertical", outline: "none", boxSizing: "border-box",
                    }}
                  />
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => setShowShareModal(false)} style={{
                    background: "transparent", border: `1px solid ${c.border}`, borderRadius: 6,
                    padding: "8px 16px", fontSize: 12, color: c.textSecondary,
                    cursor: "pointer", fontFamily: SANS,
                  }}>Cancel</button>
                  <button onClick={handleShareReport} disabled={shareLoading} style={{
                    background: c.accent, border: "none", borderRadius: 6,
                    padding: "8px 20px", fontSize: 12, fontWeight: 600, color: "#fff",
                    cursor: shareLoading ? "wait" : "pointer", fontFamily: SANS,
                    opacity: shareLoading ? 0.7 : 1,
                  }}>{shareLoading ? "Creating..." : "Create report"}</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Report created</div>
                <div style={{ fontSize: 12, color: c.textMuted, marginBottom: 16 }}>
                  Anyone with this link can view the snapshot. No login required.
                </div>
                <div style={{
                  display: "flex", gap: 8, alignItems: "center",
                  background: c.input, border: `1px solid ${c.border}`, borderRadius: 6,
                  padding: "8px 12px",
                }}>
                  <input
                    readOnly value={shareLink}
                    onFocus={(e) => e.target.select()}
                    style={{
                      flex: 1, background: "transparent", border: "none",
                      color: c.text, fontSize: 12, fontFamily: MONO, outline: "none",
                    }}
                  />
                  <button onClick={() => { navigator.clipboard.writeText(shareLink); }} style={{
                    background: c.accent, border: "none", borderRadius: 4,
                    padding: "4px 12px", fontSize: 11, fontWeight: 600, color: "#fff",
                    cursor: "pointer", fontFamily: SANS, whiteSpace: "nowrap",
                  }}>Copy</button>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                  <button onClick={() => setShowShareModal(false)} style={{
                    background: "transparent", border: `1px solid ${c.border}`, borderRadius: 6,
                    padding: "8px 16px", fontSize: 12, color: c.textSecondary,
                    cursor: "pointer", fontFamily: SANS,
                  }}>Done</button>
                </div>
              </>
            )}
          </div>
        </>
      )}
      {loading && <div style={{ textAlign: "center", padding: 60, color: c.textMuted }}><div style={{ fontSize: 13 }}>{step}</div></div>}

      {/* Forecasting view (replaces cycle content) */}
      {!loading && selectedTeam && showForecasting && (
        <div>
          <DriftTrends cycles={cycles} activeCycleId={activeCycle?.id} />
          <CompletionEstimates teamId={selectedTeam.id} cycles={cycles} />
        </div>
      )}

      {!loading && selectedTeam && showInsights && !showForecasting && (
        <InsightsView issues={issues} cycle={activeCycle} avatars={avatars} />
      )}

      {!loading && selectedTeam && !showForecasting && !showInsights && (
        <>
          {/* Summary strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, marginBottom: 16 }}>
            {[
              { label: "Issues", value: issues.length, color: c.text },
              { label: "Assigned", value: `${totalPts}${u}`, color: c.accent },
              { label: "Done", value: `${donePts}${u}`, color: c.green },
              { label: "Progress", value: `${pctDone}%`, color: pctDone > 60 ? c.green : c.textSecondary },
              { label: "Capacity", value: `${totalCap}${u}`, color: totalPts > totalCap ? c.red : c.textSecondary },
              { label: "Unestimated", value: unestCount, color: unestCount > 0 ? c.yellow : c.textMuted },
            ].map((s) => (
              <div key={s.label} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: MONO }}>{s.value}</div>
                <div style={{ fontSize: 9, color: c.textMuted, marginTop: 1, textTransform: "uppercase", letterSpacing: 0.5 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, marginBottom: 14, borderBottom: `1px solid ${c.border}` }}>
            {[{ id: "capacity", label: "Capacity", Icon: IconCapacity }, { id: "burndown", label: "Burndown", Icon: IconBurndown }, { id: "velocity", label: "Velocity", Icon: IconVelocity }, { id: "estimates", label: "Estimates", Icon: IconEstimates }, { id: "board", label: "Board", Icon: IconBoard }].map((tab) => (
              <button key={tab.id} onClick={() => switchTab(tab.id)} style={{
                background: "transparent", border: "none",
                borderBottom: activeTab === tab.id ? `2px solid ${c.accent}` : "2px solid transparent",
                padding: "8px 16px", fontSize: 13, fontWeight: activeTab === tab.id ? 600 : 400,
                color: activeTab === tab.id ? c.text : c.textMuted,
                cursor: "pointer", fontFamily: SANS, marginBottom: -1,
                display: "inline-flex", alignItems: "center", gap: 5,
              }}><tab.Icon style={{ width: 13, height: 13 }} />{tab.label}</button>
            ))}
          </div>

          {/* Burndown tab */}
          {activeTab === "burndown" && (
            <div>
              {activeCycle ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 13, color: c.textSecondary, fontWeight: 600 }}>Cycle {activeCycle.number} Burndown</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {["hours", "issues"].map((m) => (
                        <button key={m} onClick={() => setBurndownMode(m)} style={{
                          background: burndownMode === m ? c.accentBg : "transparent",
                          border: `1px solid ${burndownMode === m ? c.accent : c.border}`,
                          borderRadius: 4, padding: "3px 8px", fontSize: 10,
                          color: burndownMode === m ? c.accent : c.textMuted,
                          cursor: "pointer", fontFamily: MONO, textTransform: "capitalize",
                        }}>{m}</button>
                      ))}
                    </div>
                  </div>
                  <BurndownChart cycle={activeCycle} mode={burndownMode} issues={issues} />
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5, fontSize: 10, color: c.textMuted }}>Per-person load</div>
                    {people.map((p) => {
                      const pI = flatIssues(byPerson[p] || []);
                      const pts = pI.reduce((s, i) => s + (i.estimate || 0), 0);
                      const dp = pI.filter((i) => i.stateType === "completed").reduce((s, i) => s + (i.estimate || 0), 0);
                      return (
                        <div key={p} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: `1px solid ${c.divider}` }}>
                          {avatars[p] ? (
                            <img src={avatars[p]} alt={p} style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0 }} />
                          ) : (
                            <span style={{ width: 20, flexShrink: 0 }} />
                          )}
                          <span style={{ minWidth: 80, color: c.textSecondary, fontSize: 13 }}>{p.split(" ")[0]}</span>
                          <div style={{ flex: 1 }}><CapacityBar assigned={pts} capacity={capacities[p] || 0} done={dp} /></div>
                          <span style={{ fontFamily: MONO, fontSize: 11, color: c.green, minWidth: 50, textAlign: "right" }}>{dp}{u} done</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : <div style={{ textAlign: "center", padding: 40, color: c.textMuted, fontSize: 13 }}>No cycle available.</div>}
            </div>
          )}

          {/* Velocity tab */}
          {activeTab === "velocity" && (
            <div>
              {activeCycle ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 13, color: c.textSecondary, fontWeight: 600 }}>Cycle {activeCycle.number} Velocity</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {["hours", "issues"].map((m) => (
                        <button key={m} onClick={() => setBurndownMode(m)} style={{
                          background: burndownMode === m ? c.accentBg : "transparent",
                          border: `1px solid ${burndownMode === m ? c.accent : c.border}`,
                          borderRadius: 4, padding: "3px 8px", fontSize: 10,
                          color: burndownMode === m ? c.accent : c.textMuted,
                          cursor: "pointer", fontFamily: MONO, textTransform: "capitalize",
                        }}>{m}</button>
                      ))}
                    </div>
                  </div>
                  <VelocityChart cycle={activeCycle} mode={burndownMode} issues={issues} />
                </>
              ) : <div style={{ textAlign: "center", padding: 40, color: c.textMuted, fontSize: 13 }}>No cycle available.</div>}
            </div>
          )}

          {/* Estimates tab */}
          {activeTab === "estimates" && (
            <EstimatesView issues={issues} cycle={activeCycle} avatars={avatars} />
          )}

          {/* Board tab */}
          {activeTab === "board" && (
            <KanbanBoard teamId={selectedTeam.id} cycleId={activeCycle?.id} demo={demo} />
          )}

          {/* Capacity tab */}
          {activeTab === "capacity" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                <button onClick={() => setShowSettings((s) => !s)} style={{
                  background: showSettings ? c.accentBg : c.card,
                  border: `1px solid ${showSettings ? c.accent : c.border}`, borderRadius: 5,
                  padding: "4px 10px", fontSize: 11,
                  color: showSettings ? c.accent : c.text,
                  cursor: "pointer", fontFamily: SANS,
                  display: "inline-flex", alignItems: "center", gap: 4,
                }}><IconEdit style={{ width: 12, height: 12 }} />Edit capacity</button>
                <button onClick={() => setAllExpanded((e) => !e)} style={{
                  background: c.card, border: `1px solid ${c.border}`, borderRadius: 5,
                  padding: "4px 10px", fontSize: 11, color: c.textSecondary,
                  cursor: "pointer", fontFamily: SANS, display: "inline-flex", alignItems: "center", gap: 4,
                }}>{allExpanded ? <><IconCollapse style={{ width: 12, height: 12 }} />Collapse all</> : <><IconExpand style={{ width: 12, height: 12 }} />Expand all</>}</button>
              </div>
              {showSettings && activeCycle && (
                <AvailabilityCalendar
                  people={people}
                  cycle={activeCycle}
                  teamId={selectedTeam.id}
                  onCapacitiesChange={setCapacities}
                />
              )}
              {showSettings && !activeCycle && (
                <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: "16px 20px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: c.textMuted, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Capacity per person (hours/cycle)</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    {people.map((p) => (
                      <div key={p} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, color: c.textSecondary, minWidth: 80 }}>{p.split(" ")[0]}</span>
                        <input type="number" min={0} value={capacities[p] || 0}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            setCapacities((prev) => ({ ...prev, [p]: val }));
                            if (selectedTeam) saveCapacities(selectedTeam.id, { ...capacities, [p]: val });
                          }}
                          style={{ width: 56, padding: "4px 6px", fontSize: 13, fontFamily: MONO, background: c.input, border: `1px solid ${c.border}`, borderRadius: 4, color: c.text, textAlign: "center", outline: "none" }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {people.map((p) => <PersonCard key={p} name={p} issues={byPerson[p] || []} capacity={capacities[p] || 0} expanded={allExpanded} avatarUrl={avatars[p]} />)}
              {(byPerson["Unassigned"]?.length || 0) > 0 && <PersonCard name="Unassigned" issues={byPerson["Unassigned"]} capacity={0} expanded={allExpanded} />}
              {issues.length === 0 && <div style={{ textAlign: "center", padding: 40, color: c.textMuted, fontSize: 13 }}>No issues found.</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

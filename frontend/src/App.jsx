import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./components/ui/dialog.jsx";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "./components/ui/dropdown-menu.jsx";
import {
  fetchTeams, fetchTeamData, fetchCycleIssues, fetchBacklogIssues,
  refreshServerCache, linearQuery, ISSUE_HISTORY_QUERY,
} from "./api.js";
import {
  pickActiveCycle, groupByAssignee, enrichIssues, flatIssues,
  loadCapacities, saveCapacities, loadAvailability, computeCapacities, formatDate,
  sumEstimates,
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
import StandupView from "./components/StandupView.jsx";
import {
  IconInsights, IconForecast, IconShare, IconCapacity, IconBurndown,
  IconVelocity, IconEstimates, IconBoard, IconEdit, IconCollapse, IconExpand,
  IconStandup,
} from "./icons.jsx";
import InsightsView from "./components/InsightsView.jsx";

const MONO = "'JetBrains Mono', 'SF Mono', monospace";
const SANS = "'DM Sans', system-ui, sans-serif";

export default function App({ demo = false }) {
  const { colors, mode, toggle, fontScale, setFontScale, fontSizeLabel, fontScales } = useTheme();
  const { auth, logout, showPlanSelection, updateSettings: cloudUpdateSettings } = useAuth();
  // Demo mode uses local state for owner settings since there's no tenant to persist against.
  const [demoSettings, setDemoSettings] = useState({});
  const updateSettings = demo
    ? (patch) => setDemoSettings((prev) => ({ ...prev, ...patch }))
    : cloudUpdateSettings;
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
  const [showStandup, setShowStandup] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareNote, setShareNote] = useState("");
  const [shareLink, setShareLink] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);

  // Radix Dialog relies on @radix-ui/react-remove-scroll which leaves
  // `pointer-events: none` on <body> after close in our setup — likely because theme.jsx
  // writes its own inline body styles (background/color) that interfere with the lib's
  // save/restore snapshot. Poll briefly after any modal closes and clear it ourselves
  // so the UI never gets stuck unclickable.
  useEffect(() => {
    if (showPrefs || showShareModal) return;
    const clear = () => {
      if (document.body.style.pointerEvents === "none") {
        document.body.style.pointerEvents = "";
      }
    };
    const handles = [0, 50, 200, 500].map((d) => setTimeout(clear, d));
    return () => handles.forEach(clearTimeout);
  }, [showPrefs, showShareModal]);

  // Settings: cloud mode reads from tenant settings, demo mode reads from local state.
  const activeSettings = demo ? demoSettings : (auth && typeof auth === "object" ? auth.settings : null) || {};
  const unit = activeSettings.unit || "hours";
  const u = unit === "points" ? "p" : "h";
  const rollupMode = activeSettings.estimate_rollup || "children";
  const backfillClosed = !!activeSettings.backfill_closed_cycles;
  const defaultPerDay = activeSettings.default_points_per_day ?? 2;

  // Live update listener
  const selectedTeamRef = useRef(null);
  const activeCycleRef = useRef(null);

  // Hours/points-per-day is a tenant-wide preference (not per-cycle). Whenever it
  // changes, recompute capacities for the active cycle using the off-day grid in
  // availability — but always with the preference as the per-day rate.
  useEffect(() => {
    if (!selectedTeam || !activeCycle || people.length === 0) return;
    let cancelled = false;
    loadAvailability(selectedTeam.id, activeCycle.id).then((avail) => {
      if (cancelled) return;
      setCapacities(computeCapacities({ ...avail, pointsPerDay: defaultPerDay }, people, activeCycle.startsAt, activeCycle.endsAt));
    });
    return () => { cancelled = true; };
  }, [defaultPerDay, selectedTeam?.id, activeCycle?.id, people.join("|")]);

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
        setCapacities(computeCapacities({ ...avail, pointsPerDay: defaultPerDay }, uniq, picked.startsAt, picked.endsAt));
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
      setCapacities(computeCapacities({ ...avail, pointsPerDay: defaultPerDay }, uniq, cycle.startsAt, cycle.endsAt));
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

  const byPerson = groupByAssignee(issues, people);
  const allFlat = flatIssues(issues);
  const totalPts = sumEstimates(issues, rollupMode);
  const totalCap = people.reduce((s, p) => s + (capacities[p] || 0), 0);
  const donePts = sumEstimates(issues, rollupMode, (i) => i.stateType === "completed");
  const unestCount = allFlat.filter((i) => !i.estimate).length;
  const pctDone = totalPts > 0 ? Math.round((donePts / totalPts) * 100) : 0;

  const handleShareReport = async () => {
    if (!selectedTeam || !activeCycle) return;
    setShareLoading(true);
    try {
      // Build per-project progress snapshot from top-level issues (so rollup totals don't double-count).
      const projectMap = {};
      for (const issue of issues) {
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
        const total = sumEstimates(proj.issues, rollupMode);
        const done = sumEstimates(proj.issues, rollupMode, (i) => i.stateType === "completed");
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const milestones = Object.values(proj.milestones).map((ms) => {
          const msTotal = sumEstimates(ms.issues, rollupMode);
          const msDone = sumEstimates(ms.issues, rollupMode, (i) => i.stateType === "completed");
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button style={{
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
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[12rem]">
              {auth && auth !== "standalone" && auth.user && (
                <>
                  <DropdownMenuLabel className="normal-case tracking-normal font-normal text-muted-foreground">
                    {auth.user.email || auth.user.name}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                </>
              )}

              {/* Theme toggle — keep menu open via preventDefault */}
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); toggle(); }} className="justify-between">
                <span>Theme</span>
                <span className="text-xs text-muted-foreground font-mono">
                  {mode === "dark" ? "\u263E dark" : "\u2600 light"}
                </span>
              </DropdownMenuItem>

              {/* Font size — inline row of buttons inside the menu */}
              <div className="px-3 py-2 flex justify-between items-center gap-3">
                <span className="text-sm text-foreground">Font size</span>
                <div className="flex gap-0.5 shrink-0">
                  {fontScales.map((s) => (
                    <button key={s.label} onClick={() => setFontScale(s.value)} className="font-mono text-[11px] px-2 py-0.5 rounded-sm cursor-pointer"
                      style={{
                        background: fontScale === s.value ? c.accentBg : "transparent",
                        border: `1px solid ${fontScale === s.value ? c.accent : "transparent"}`,
                        color: fontScale === s.value ? c.accent : c.textMuted,
                      }}>{s.label}</button>
                  ))}
                </div>
              </div>

              {/* Workspace preferences — owner only, always in demo */}
              {(demo || (auth && auth !== "standalone" && auth.user?.role === "owner")) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setShowPrefs(true)}
                    className="justify-center font-semibold focus:bg-primary focus:text-primary-foreground"
                    style={{ color: c.accent, background: c.accentBg, border: `1px solid ${c.accent}`, margin: 4 }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    Preferences
                  </DropdownMenuItem>
                </>
              )}

              {auth && auth !== "standalone" && auth.user?.role === "owner" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={async () => {
                    const res = await fetch("/api/billing/portal", { method: "POST" });
                    const data = await res.json();
                    if (data.url) window.location.href = data.url;
                  }}>Manage billing</DropdownMenuItem>
                </>
              )}

              {auth && auth !== "standalone" && auth.user && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => logout()}>Sign out</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
            <button key={cy.id} onClick={() => { switchCycle(cy); setShowForecasting(false); setShowInsights(false); setShowStandup(false); }} style={{
              background: activeCycle?.id === cy.id && !showForecasting && !showInsights && !showStandup ? c.accentBg : c.card,
              border: `1px solid ${activeCycle?.id === cy.id && !showForecasting && !showInsights && !showStandup ? c.accent : c.border}`,
              borderRadius: 5, padding: "4px 10px", fontSize: 11,
              color: activeCycle?.id === cy.id && !showForecasting && !showInsights && !showStandup ? c.accent : c.textMuted,
              cursor: "pointer", fontFamily: MONO,
            }}>Cycle {cy.number}</button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={() => { setShowStandup((v) => !v); setShowInsights(false); setShowForecasting(false); }} style={{
            background: showStandup ? c.accent : c.card,
            border: `1px solid ${showStandup ? c.accent : c.border}`,
            borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600,
            color: showStandup ? "#fff" : c.textSecondary,
            cursor: "pointer", fontFamily: SANS, display: "inline-flex", alignItems: "center",
          }}><IconStandup style={{ marginRight: 5 }} />Standup</button>
          <button onClick={() => { setShowInsights((v) => !v); setShowForecasting(false); setShowStandup(false); }} style={{
            background: showInsights ? c.accent : c.card,
            border: `1px solid ${showInsights ? c.accent : c.border}`,
            borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600,
            color: showInsights ? "#fff" : c.textSecondary,
            cursor: "pointer", fontFamily: SANS, display: "inline-flex", alignItems: "center",
          }}><IconInsights style={{ marginRight: 5 }} />Insights</button>
          <button onClick={() => { setShowForecasting((f) => !f); setShowInsights(false); setShowStandup(false); }} style={{
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
      <Dialog open={showShareModal} onOpenChange={setShowShareModal}>
        <DialogContent className="max-w-md">
          {!shareLink ? (
            <>
              <DialogHeader>
                <DialogTitle>Share cycle report</DialogTitle>
                <DialogDescription>
                  Creates a snapshot of Cycle {activeCycle?.number} that anyone with the link can view.
                </DialogDescription>
              </DialogHeader>
              <div>
                <div className="text-[11px] text-muted-foreground mb-1 uppercase tracking-wider">Note (optional)</div>
                <textarea
                  value={shareNote}
                  onChange={(e) => setShareNote(e.target.value)}
                  placeholder="e.g. This cycle we focused on API v2..."
                  className="w-full min-h-[80px] px-3 py-2.5 rounded-md text-sm outline-none resize-y box-border"
                  style={{
                    background: c.input, border: `1px solid ${c.border}`,
                    color: c.text, fontFamily: SANS,
                  }}
                />
              </div>
              <DialogFooter>
                <button onClick={() => setShowShareModal(false)} className="rounded-md px-4 py-2 text-xs cursor-pointer"
                  style={{ background: "transparent", border: `1px solid ${c.border}`, color: c.textSecondary, fontFamily: SANS }}>Cancel</button>
                <button onClick={handleShareReport} disabled={shareLoading} className="rounded-md px-5 py-2 text-xs font-semibold text-white"
                  style={{ background: c.accent, cursor: shareLoading ? "wait" : "pointer", opacity: shareLoading ? 0.7 : 1, fontFamily: SANS }}>
                  {shareLoading ? "Creating..." : "Create report"}
                </button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Report created</DialogTitle>
                <DialogDescription>
                  Anyone with this link can view the snapshot. No login required.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 rounded-md px-3 py-2"
                style={{ background: c.input, border: `1px solid ${c.border}` }}>
                <input
                  readOnly value={shareLink}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 bg-transparent border-none outline-none text-xs"
                  style={{ color: c.text, fontFamily: MONO }}
                />
                <button onClick={() => { navigator.clipboard.writeText(shareLink); }} className="rounded px-3 py-1 text-[11px] font-semibold text-white cursor-pointer whitespace-nowrap"
                  style={{ background: c.accent, fontFamily: SANS }}>Copy</button>
              </div>
              <DialogFooter>
                <button onClick={() => setShowShareModal(false)} className="rounded-md px-4 py-2 text-xs cursor-pointer"
                  style={{ background: "transparent", border: `1px solid ${c.border}`, color: c.textSecondary, fontFamily: SANS }}>Done</button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={showPrefs} onOpenChange={setShowPrefs}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Preferences</DialogTitle>
            <DialogDescription>
              Workspace-wide settings. {demo ? "In demo mode these apply locally, for this session only." : "Applies to everyone on the team."}
            </DialogDescription>
          </DialogHeader>

          {/* Estimate unit */}
          <div className="py-3 border-t border-border">
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="text-sm font-semibold text-foreground">Estimate unit</div>
              <div className="flex gap-0.5 shrink-0">
                {[{ id: "hours", label: "Hours" }, { id: "points", label: "Points" }].map((opt) => (
                  <button key={opt.id} onClick={() => updateSettings({ unit: opt.id })} className="font-mono text-xs px-3 py-1 rounded cursor-pointer transition-colors"
                    style={{
                      background: unit === opt.id ? c.accentBg : "transparent",
                      border: `1px solid ${unit === opt.id ? c.accent : c.border}`,
                      color: unit === opt.id ? c.accent : c.textMuted,
                    }}>{opt.label}</button>
                ))}
              </div>
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              How estimates are displayed across capacity, burndown, and forecasting views.
            </div>
          </div>

          {/* Default per-day capacity */}
          <div className="py-3 border-t border-border">
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="text-sm font-semibold text-foreground">
                Default {unit === "points" ? "points" : "hours"} per day
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="number" min={0.5} step={0.5}
                  value={defaultPerDay}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v >= 0) updateSettings({ default_points_per_day: v });
                  }}
                  className="px-2.5 py-1 text-sm font-mono rounded outline-none text-center"
                  style={{
                    width: 72,
                    background: c.input, border: `1px solid ${c.border}`, color: c.text,
                  }}
                />
                <span className="text-xs font-mono text-muted-foreground">{u}/day</span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              Per-person daily capacity used across the cycle. Off-days and half-days can still be customised per cycle in the availability grid.
            </div>
          </div>

          {/* Parent estimate rollup */}
          <div className="py-3 border-t border-border">
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="text-sm font-semibold text-foreground">Parent estimate</div>
              <div className="flex gap-0.5 shrink-0">
                {[{ id: "children", label: "Sum of subs" }, { id: "parent", label: "Own" }].map((opt) => (
                  <button key={opt.id} onClick={() => updateSettings({ estimate_rollup: opt.id })} className="font-mono text-xs px-3 py-1 rounded cursor-pointer"
                    style={{
                      background: rollupMode === opt.id ? c.accentBg : "transparent",
                      border: `1px solid ${rollupMode === opt.id ? c.accent : c.border}`,
                      color: rollupMode === opt.id ? c.accent : c.textMuted,
                    }}>{opt.label}</button>
                ))}
              </div>
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              {rollupMode === "children"
                ? "When a parent has estimated sub-issues, use the sum of the sub-issues. Otherwise use the parent's own estimate. Recommended because Fibonacci estimates rarely add up cleanly."
                : "Always trust the parent's estimate. Ignore sub-issue estimates entirely."}
            </div>
          </div>

          {/* Backfill closed cycles */}
          <div className="py-3 border-t border-border">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={backfillClosed}
                onChange={(e) => updateSettings({ backfill_closed_cycles: e.target.checked })}
                className="mt-0.5 cursor-pointer w-4 h-4"
              />
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Adjust closed cycles when sub-issue estimates change
                </div>
                <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Off keeps historical drift frozen as of when each cycle ended. On re-computes past cycles' drift when a sub-issue is later re-estimated — more honest, but historical numbers can move.
                </div>
              </div>
            </label>
          </div>

          <DialogFooter>
            <button onClick={() => setShowPrefs(false)} className="rounded-md px-5 py-2 text-xs font-semibold text-white cursor-pointer"
              style={{ background: c.accent, fontFamily: SANS }}>Done</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {loading && <div style={{ textAlign: "center", padding: 60, color: c.textMuted }}><div style={{ fontSize: 13 }}>{step}</div></div>}

      {/* Forecasting view (replaces cycle content) */}
      {!loading && selectedTeam && showForecasting && (
        <div>
          <DriftTrends cycles={cycles} activeCycleId={activeCycle?.id} />
          <CompletionEstimates teamId={selectedTeam.id} cycles={cycles} />
        </div>
      )}

      {!loading && selectedTeam && showStandup && !showInsights && !showForecasting && (
        <StandupView issues={issues} people={people} avatars={avatars} />
      )}

      {!loading && selectedTeam && showInsights && !showForecasting && !showStandup && (
        <InsightsView issues={issues} cycle={activeCycle} cycles={cycles} avatars={avatars} rollupMode={rollupMode} />
      )}

      {!loading && selectedTeam && !showForecasting && !showInsights && !showStandup && (
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
                  <BurndownChart cycle={activeCycle} mode={burndownMode} issues={issues} rollupMode={rollupMode} />
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5, fontSize: 10, color: c.textMuted }}>Per-person load</div>
                    {people.map((p) => {
                      const personTop = byPerson[p] || [];
                      // Per-person load: ghost parents only contribute via their same-assignee children.
                      let pts = 0, dp = 0;
                      for (const i of personTop) {
                        if (i.ghost) {
                          for (const ch of (i.children || [])) {
                            pts += ch.estimate || 0;
                            if (ch.stateType === "completed") dp += ch.estimate || 0;
                          }
                        } else if (rollupMode === "parent") {
                          pts += i.estimate || 0;
                          if (i.stateType === "completed") dp += i.estimate || 0;
                        } else {
                          const kids = i.children || [];
                          const any = kids.some((ch) => ch.estimate != null);
                          if (any) {
                            for (const ch of kids) {
                              pts += ch.estimate || 0;
                              if (ch.stateType === "completed") dp += ch.estimate || 0;
                            }
                          } else {
                            pts += i.estimate || 0;
                            if (i.stateType === "completed") dp += i.estimate || 0;
                          }
                        }
                      }
                      const pI = flatIssues(personTop);
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
            <EstimatesView issues={issues} cycle={activeCycle} avatars={avatars} rollupMode={rollupMode} backfillClosed={backfillClosed} />
          )}

          {/* Board tab */}
          {activeTab === "board" && (
            <KanbanBoard teamId={selectedTeam.id} cycleId={activeCycle?.id} demo={demo}
              previousCycleId={(() => {
                if (!activeCycle) return null;
                const idx = cycles.findIndex((cy) => cy.id === activeCycle.id);
                return idx > 0 ? cycles[idx - 1].id : null;
              })()} />
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
                  defaultPerDay={defaultPerDay}
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

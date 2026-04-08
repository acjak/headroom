import { useState, useEffect, useCallback } from "react";
import {
  linearQuery, TEAMS_QUERY, TEAM_DATA_QUERY,
  CYCLE_ISSUES_QUERY, BACKLOG_ISSUES_QUERY,
} from "./api.js";
import {
  pickActiveCycle, groupByAssignee, enrichIssues,
  loadCapacities, saveCapacities, loadAvailability, computeCapacities, formatDate,
} from "./utils.js";
import { useTheme } from "./theme.jsx";
import BurndownChart from "./components/BurndownChart.jsx";
import CapacityBar from "./components/CapacityBar.jsx";
import PersonCard from "./components/PersonCard.jsx";
import AvailabilityCalendar from "./components/AvailabilityCalendar.jsx";

const MONO = "'JetBrains Mono', 'SF Mono', monospace";
const SANS = "'DM Sans', system-ui, sans-serif";

export default function App() {
  const { colors, mode, toggle } = useTheme();
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
  const [burndownMode, setBurndownMode] = useState("points");
  const [activeTab, setActiveTab] = useState("capacity");

  // Initial load: fetch teams
  useEffect(() => {
    (async () => {
      try {
        setStep("Fetching teams...");
        const data = await linearQuery(TEAMS_QUERY);
        setTeams(data.teams.nodes);
        if (data.teams.nodes.length === 1) setSelectedTeam(data.teams.nodes[0]);
        if (data.teams.nodes.length === 0) setError("No teams found in Linear workspace");
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
      const data = await linearQuery(TEAM_DATA_QUERY, { teamId: team.id });
      const t = data.team;
      const allCycles = (t.cycles.nodes || []).sort((a, b) => a.number - b.number);
      setCycles(allCycles);

      const members = (t.members?.nodes || []).map((m) => m.name || m.displayName);
      setTeamMembers(members);

      const picked = pickActiveCycle(allCycles);
      setActiveCycle(picked);

      setStep("Loading issues...");
      let issueNodes = [];
      if (picked) {
        const iData = await linearQuery(CYCLE_ISSUES_QUERY, { cycleId: picked.id });
        issueNodes = iData.cycle.issues.nodes;
      } else {
        const iData = await linearQuery(BACKLOG_ISSUES_QUERY, { teamId: team.id });
        issueNodes = iData.team.issues.nodes;
      }

      const enriched = enrichIssues(issueNodes);
      setIssues(enriched);

      const fromIssues = enriched.map((i) => i.assigneeName).filter((n) => n !== "Unassigned");
      const uniq = [...new Set([...members, ...fromIssues])];
      setPeople(uniq);

      if (picked) {
        const avail = loadAvailability(team.id, picked.id);
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
      const iData = await linearQuery(CYCLE_ISSUES_QUERY, { cycleId: cycle.id });
      const enriched = enrichIssues(iData.cycle.issues.nodes);
      setIssues(enriched);
      const fromIssues = enriched.map((i) => i.assigneeName).filter((n) => n !== "Unassigned");
      const uniq = [...new Set([...teamMembers, ...fromIssues])];
      setPeople(uniq);
      const avail = loadAvailability(selectedTeam.id, cycle.id);
      setCapacities(computeCapacities(avail, uniq, cycle.startsAt, cycle.endsAt));
    } catch (e) {
      setError("Failed: " + e.message);
    }
    setLoading(false);
  }, [selectedTeam, teamMembers]);

  useEffect(() => { if (selectedTeam) loadTeam(selectedTeam); }, [selectedTeam, loadTeam]);

  const switchCycle = (c) => {
    setActiveCycle(c);
    loadCycleIssues(c);
  };

  const byPerson = groupByAssignee(issues, people);
  const totalPts = issues.reduce((s, i) => s + (i.estimate || 0), 0);
  const totalCap = people.reduce((s, p) => s + (capacities[p] || 0), 0);
  const donePts = issues.filter((i) => i.stateType === "completed").reduce((s, i) => s + (i.estimate || 0), 0);
  const unestCount = issues.filter((i) => !i.estimate).length;
  const pctDone = totalPts > 0 ? Math.round((donePts / totalPts) * 100) : 0;

  const c = colors;

  return (
    <div style={{ fontFamily: SANS, background: c.bg, color: c.text, minHeight: "100vh", padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>Headroom</h1>
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
          <button onClick={toggle} style={{
            background: c.card, border: `1px solid ${c.border}`, borderRadius: 6,
            padding: "5px 10px", fontSize: 11, color: c.textSecondary,
            cursor: "pointer", fontFamily: SANS,
          }}>{mode === "dark" ? "\u2600" : "\u263E"}</button>
          <button onClick={() => setShowSettings((s) => !s)} style={{
            background: showSettings ? c.accentBg : c.card,
            border: `1px solid ${c.border}`, borderRadius: 6, padding: "5px 10px", fontSize: 11,
            color: showSettings ? c.accent : c.textSecondary, cursor: "pointer", fontFamily: SANS,
          }}>{"\u2699"} Capacity</button>
          <button onClick={() => selectedTeam && loadTeam(selectedTeam)} disabled={loading} style={{
            background: c.card, border: `1px solid ${c.border}`, borderRadius: 6,
            padding: "5px 10px", fontSize: 11, color: c.textSecondary,
            cursor: loading ? "wait" : "pointer", fontFamily: SANS,
          }}>{"\u21BB"} Refresh</button>
        </div>
      </div>

      {/* Cycle pills */}
      {cycles.length > 1 && !loading && (
        <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
          {cycles.map((cy) => (
            <button key={cy.id} onClick={() => switchCycle(cy)} style={{
              background: activeCycle?.id === cy.id ? c.accentBg : c.card,
              border: `1px solid ${activeCycle?.id === cy.id ? c.accent : c.border}`,
              borderRadius: 5, padding: "4px 10px", fontSize: 11,
              color: activeCycle?.id === cy.id ? c.accent : c.textMuted,
              cursor: "pointer", fontFamily: MONO,
            }}>Cycle {cy.number}</button>
          ))}
        </div>
      )}

      {error && <div style={{ background: c.redBg, border: `1px solid ${c.redBorder}`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: c.red }}>{error}</div>}
      {loading && <div style={{ textAlign: "center", padding: 60, color: c.textMuted }}><div style={{ fontSize: 13 }}>{step}</div></div>}

      {!loading && selectedTeam && (
        <>
          {/* Summary strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, marginBottom: 16 }}>
            {[
              { label: "Issues", value: issues.length, color: c.text },
              { label: "Assigned", value: `${totalPts}pt`, color: c.accent },
              { label: "Done", value: `${donePts}pt`, color: c.green },
              { label: "Progress", value: `${pctDone}%`, color: pctDone > 60 ? c.green : c.textSecondary },
              { label: "Capacity", value: `${totalCap}pt`, color: totalPts > totalCap ? c.red : c.textSecondary },
              { label: "Unestimated", value: unestCount, color: unestCount > 0 ? c.yellow : c.textMuted },
            ].map((s) => (
              <div key={s.label} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: MONO }}>{s.value}</div>
                <div style={{ fontSize: 9, color: c.textMuted, marginTop: 1, textTransform: "uppercase", letterSpacing: 0.5 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Capacity settings */}
          {showSettings && activeCycle && (
            <AvailabilityCalendar
              people={people}
              cycle={activeCycle}
              teamId={selectedTeam.id}
              onCapacitiesChange={setCapacities}
            />
          )}
          {showSettings && !activeCycle && (
            <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: "16px 20px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: c.textMuted, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Capacity per person (pts/cycle)</div>
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

          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, marginBottom: 14, borderBottom: `1px solid ${c.border}` }}>
            {[{ id: "capacity", label: "Capacity" }, { id: "burndown", label: "Burndown" }].map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                background: "transparent", border: "none",
                borderBottom: activeTab === tab.id ? `2px solid ${c.accent}` : "2px solid transparent",
                padding: "8px 16px", fontSize: 13, fontWeight: activeTab === tab.id ? 600 : 400,
                color: activeTab === tab.id ? c.text : c.textMuted,
                cursor: "pointer", fontFamily: SANS, marginBottom: -1,
              }}>{tab.label}</button>
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
                      {["points", "issues"].map((m) => (
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
                  <BurndownChart cycle={activeCycle} mode={burndownMode} />
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5, fontSize: 10, color: c.textMuted }}>Per-person load</div>
                    {people.map((p) => {
                      const pI = byPerson[p] || [];
                      const pts = pI.reduce((s, i) => s + (i.estimate || 0), 0);
                      const dp = pI.filter((i) => i.stateType === "completed").reduce((s, i) => s + (i.estimate || 0), 0);
                      return (
                        <div key={p} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: `1px solid ${c.divider}` }}>
                          <span style={{ minWidth: 100, color: c.textSecondary, fontSize: 13 }}>{p.split(" ")[0]}</span>
                          <div style={{ flex: 1 }}><CapacityBar assigned={pts} capacity={capacities[p] || 0} /></div>
                          <span style={{ fontFamily: MONO, fontSize: 11, color: c.green, minWidth: 50, textAlign: "right" }}>{dp}pt done</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : <div style={{ textAlign: "center", padding: 40, color: c.textMuted, fontSize: 13 }}>No cycle available.</div>}
            </div>
          )}

          {/* Capacity tab */}
          {activeTab === "capacity" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {people.map((p) => <PersonCard key={p} name={p} issues={byPerson[p] || []} capacity={capacities[p] || 0} />)}
              {(byPerson["Unassigned"]?.length || 0) > 0 && <PersonCard name="Unassigned" issues={byPerson["Unassigned"]} capacity={0} />}
              {issues.length === 0 && <div style={{ textAlign: "center", padding: 40, color: c.textMuted, fontSize: 13 }}>No issues found.</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

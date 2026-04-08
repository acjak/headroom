import { useState, useEffect, useCallback } from "react";
import { getWorkdays, loadAvailability, saveAvailability, computeCapacities } from "../utils.js";
import { useTheme } from "../theme.jsx";

const MONO = "'JetBrains Mono', 'SF Mono', monospace";
const SANS = "'DM Sans', system-ui, sans-serif";

const STATE_CYCLE = ["available", "half", "full"];

function dayLabel(d) {
  const day = d.toLocaleDateString("en-US", { weekday: "short" });
  const num = `${d.getMonth() + 1}/${d.getDate()}`;
  return { day, num };
}

export default function AvailabilityCalendar({ people, cycle, teamId, onCapacitiesChange }) {
  const { colors: c } = useTheme();
  const [availability, setAvailability] = useState(() => loadAvailability(teamId, cycle.id));

  const stateColors = {
    available: { bg: `${c.green}22`, border: c.green, label: "" },
    half: { bg: `${c.yellow}33`, border: c.yellow, label: "\u00BD" },
    full: { bg: `${c.red}1a`, border: `${c.red}44`, label: "\u2715" },
  };

  // Reset when cycle or team changes
  useEffect(() => {
    const loaded = loadAvailability(teamId, cycle.id);
    setAvailability(loaded);
  }, [teamId, cycle.id]);

  // Persist and notify on every change
  useEffect(() => {
    saveAvailability(teamId, cycle.id, availability);
    const caps = computeCapacities(availability, people, cycle.startsAt, cycle.endsAt);
    onCapacitiesChange(caps);
  }, [availability, people, cycle, teamId, onCapacitiesChange]);

  const workdays = getWorkdays(cycle.startsAt, cycle.endsAt);

  const toggleCell = useCallback((person, dateKey) => {
    setAvailability((prev) => {
      const personOffs = { ...(prev.people?.[person] || {}) };
      const current = personOffs[dateKey] || "available";
      const idx = STATE_CYCLE.indexOf(current);
      const next = STATE_CYCLE[(idx + 1) % STATE_CYCLE.length];
      if (next === "available") delete personOffs[dateKey];
      else personOffs[dateKey] = next;
      return { ...prev, people: { ...prev.people, [person]: personOffs } };
    });
  }, []);

  const setPpd = useCallback((val) => {
    setAvailability((prev) => ({ ...prev, pointsPerDay: val }));
  }, []);

  const caps = computeCapacities(availability, people, cycle.startsAt, cycle.endsAt);

  return (
    <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: "20px 24px", marginBottom: 16 }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: c.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Availability &middot; Cycle {cycle.number}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, color: c.textMuted }}>pts/day</span>
          <input
            type="number" min={0.5} step={0.5}
            value={availability.pointsPerDay}
            onChange={(e) => setPpd(parseFloat(e.target.value) || 0)}
            style={{
              width: 56, padding: "5px 8px", fontSize: 16, fontFamily: MONO,
              background: c.input, border: `1px solid ${c.border}`, borderRadius: 4,
              color: c.text, textAlign: "center", outline: "none",
            }}
          />
        </div>
      </div>

      {/* Grid */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: workdays.length * 52 + 220 }}>
          <thead>
            <tr>
              <th style={{ position: "sticky", left: 0, background: c.card, zIndex: 2, textAlign: "left", padding: "0 12px 8px 0", fontSize: 13, color: c.textMuted }}>
                Person
              </th>
              {workdays.map((d) => {
                const { day, num } = dayLabel(d);
                return (
                  <th key={d.toISOString()} style={{ padding: "0 2px 8px", fontSize: 12, color: c.textMuted, fontWeight: 400, fontFamily: MONO, whiteSpace: "nowrap", minWidth: 48 }}>
                    <div>{day}</div>
                    <div style={{ color: c.textDim }}>{num}</div>
                  </th>
                );
              })}
              <th style={{ padding: "0 0 8px 12px", fontSize: 14, color: c.textMuted, textAlign: "right", fontWeight: 600 }}>
                Capacity
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => {
              const offs = availability.people?.[person] || {};
              return (
                <tr key={person}>
                  <td style={{
                    position: "sticky", left: 0, background: c.card, zIndex: 1,
                    padding: "5px 12px 5px 0", fontSize: 15, color: c.textSecondary,
                    whiteSpace: "nowrap", borderTop: `1px solid ${c.divider}`,
                  }}>
                    {person.split(" ")[0]}
                  </td>
                  {workdays.map((d) => {
                    const key = d.toISOString().slice(0, 10);
                    const state = offs[key] || "available";
                    const sc = stateColors[state];
                    return (
                      <td key={key} style={{ padding: 3, borderTop: `1px solid ${c.divider}` }}>
                        <button
                          onClick={() => toggleCell(person, key)}
                          style={{
                            width: "100%", minWidth: 42, height: 36,
                            background: sc.bg, border: `1px solid ${sc.border}`,
                            borderRadius: 5, cursor: "pointer",
                            color: state === "full" ? `${c.red}88` : state === "half" ? c.yellow : `${c.green}44`,
                            fontSize: 16, fontWeight: 700, fontFamily: SANS,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}
                        >
                          {sc.label}
                        </button>
                      </td>
                    );
                  })}
                  <td style={{
                    padding: "5px 0 5px 12px", fontSize: 16, fontFamily: MONO,
                    color: c.text, textAlign: "right", fontWeight: 600,
                    borderTop: `1px solid ${c.divider}`, whiteSpace: "nowrap",
                  }}>
                    {caps[person]}pt
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 13, color: c.textMuted }}>
        <span><span style={{ color: c.green }}>■</span> Available</span>
        <span><span style={{ color: c.yellow }}>■</span> Half day</span>
        <span><span style={{ color: c.red }}>■</span> Off</span>
        <span style={{ marginLeft: "auto" }}>Click to cycle</span>
      </div>
    </div>
  );
}

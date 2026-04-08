import React from "react";
import { useTheme } from "../theme.jsx";

export default function CapacityBar({ assigned, capacity }) {
  const { colors: c } = useTheme();
  const pct = capacity > 0 ? Math.min((assigned / capacity) * 100, 150) : 0;
  const over = assigned > capacity && capacity > 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
      <div style={{ flex: 1, height: 6, background: c.barTrack, borderRadius: 3 }}>
        <div style={{
          width: `${Math.min(pct, 100)}%`,
          height: "100%",
          borderRadius: 3,
          background: over ? c.red : pct > 80 ? c.yellow : c.green,
          transition: "width 0.4s ease",
        }} />
      </div>
      <span style={{
        fontSize: 12,
        fontFamily: "'JetBrains Mono', monospace",
        color: over ? c.red : c.textSecondary,
        fontWeight: over ? 700 : 400,
        minWidth: 60,
        textAlign: "right",
      }}>
        {assigned} / {capacity > 0 ? capacity : "?"}
      </span>
    </div>
  );
}

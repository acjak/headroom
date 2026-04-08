import { createContext, useContext, useState, useEffect } from "react";

const dark = {
  bg: "#0d0f14",
  card: "#14161d",
  border: "#22252e",
  divider: "#1a1d24",
  text: "#e4e6eb",
  textSecondary: "#a8acb8",
  textMuted: "#5f6472",
  textDim: "#3e4350",
  input: "#0d0f14",
  accent: "#5b7fff",
  accentBg: "rgba(91,127,255,0.1)",
  green: "#36b87a",
  yellow: "#e8a820",
  red: "#ff4d4d",
  redBg: "rgba(255,77,77,0.1)",
  redBorder: "rgba(255,77,77,0.2)",
  barTrack: "#1a1d24",
  tooltip: "#1a1d25",
  gridLine: "#22252e",
};

const light = {
  bg: "#f4f5f7",
  card: "#ffffff",
  border: "#e0e2e6",
  divider: "#ecedf0",
  text: "#1a1d24",
  textSecondary: "#4a4e5a",
  textMuted: "#6b7080",
  textDim: "#9ba0ad",
  input: "#f4f5f7",
  accent: "#4b6fe0",
  accentBg: "rgba(75,111,224,0.08)",
  green: "#1a9a5a",
  yellow: "#c08a10",
  red: "#e03e3e",
  redBg: "rgba(224,62,62,0.06)",
  redBorder: "rgba(224,62,62,0.2)",
  barTrack: "#e0e2e6",
  tooltip: "#ffffff",
  gridLine: "#e0e2e6",
};

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem("theme") || "dark"; } catch { return "dark"; }
  });

  useEffect(() => {
    try { localStorage.setItem("theme", mode); } catch {}
    document.body.style.background = mode === "dark" ? dark.bg : light.bg;
    document.body.style.color = mode === "dark" ? dark.text : light.text;
  }, [mode]);

  const toggle = () => setMode((m) => m === "dark" ? "light" : "dark");
  const colors = mode === "dark" ? dark : light;

  return (
    <ThemeContext.Provider value={{ colors, mode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

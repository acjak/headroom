import { createContext, useContext, useState, useEffect } from "react";

const dark = {
  bg: "#0d0f14",
  card: "#171a22",
  border: "#2e323e",
  divider: "#1e2128",
  text: "#e4e6eb",
  textSecondary: "#b8bcc8",
  textMuted: "#9298a8",
  textDim: "#6b7080",
  input: "#0d0f14",
  accent: "#5b7fff",
  accentBg: "rgba(91,127,255,0.12)",
  green: "#36b87a",
  yellow: "#e8a820",
  red: "#ff4d4d",
  redBg: "rgba(255,77,77,0.1)",
  redBorder: "rgba(255,77,77,0.2)",
  barTrack: "#1e2128",
  tooltip: "#1e2128",
  gridLine: "#2e323e",
};

const light = {
  bg: "#f4f5f7",
  card: "#ffffff",
  border: "#d0d3d8",
  divider: "#e4e6ea",
  text: "#1a1d24",
  textSecondary: "#3a3e4a",
  textMuted: "#5a5f70",
  textDim: "#848898",
  input: "#f4f5f7",
  accent: "#4b6fe0",
  accentBg: "rgba(75,111,224,0.08)",
  green: "#1a9a5a",
  yellow: "#c08a10",
  red: "#e03e3e",
  redBg: "rgba(224,62,62,0.06)",
  redBorder: "rgba(224,62,62,0.2)",
  barTrack: "#d0d3d8",
  tooltip: "#ffffff",
  gridLine: "#d0d3d8",
};

const FONT_SCALES = [
  { label: "S", value: 1.0 },
  { label: "M", value: 1.15 },
  { label: "L", value: 1.3 },
  { label: "XL", value: 1.5 },
];

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem("theme") || "dark"; } catch { return "dark"; }
  });
  const [fontScale, setFontScale] = useState(() => {
    try { return parseFloat(localStorage.getItem("fontScale")) || 1.15; } catch { return 1.15; }
  });

  useEffect(() => {
    try { localStorage.setItem("theme", mode); } catch {}
    document.body.style.background = mode === "dark" ? dark.bg : light.bg;
    document.body.style.color = mode === "dark" ? dark.text : light.text;
    // Toggle the `dark` class for Tailwind / shadcn components that read CSS variables.
    document.documentElement.classList.toggle("dark", mode === "dark");
  }, [mode]);

  useEffect(() => {
    try { localStorage.setItem("fontScale", fontScale); } catch {}
    // Zoom the app root rather than <html>, so Radix portals mounted on <body>
    // aren't double-scaled (that breaks dropdown positioning). We expose the scale
    // as a CSS variable so portal content (dialogs, dropdowns) can opt in explicitly.
    const root = document.getElementById("root");
    if (root) root.style.zoom = fontScale;
    document.documentElement.style.zoom = "";
    document.documentElement.style.setProperty("--font-scale", String(fontScale));
  }, [fontScale]);

  const toggle = () => setMode((m) => m === "dark" ? "light" : "dark");
  const cycleFontSize = () => {
    const idx = FONT_SCALES.findIndex((s) => s.value === fontScale);
    const next = FONT_SCALES[(idx + 1) % FONT_SCALES.length];
    setFontScale(next.value);
  };
  const fontSizeLabel = FONT_SCALES.find((s) => s.value === fontScale)?.label || "M";
  const colors = mode === "dark" ? dark : light;

  return (
    <ThemeContext.Provider value={{ colors, mode, toggle, fontScale, setFontScale, fontSizeLabel, fontScales: FONT_SCALES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

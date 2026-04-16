import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { ThemeProvider } from "./theme.jsx";
import { AuthProvider, useAuth } from "./AuthContext.jsx";
import LoginPage from "./components/LoginPage.jsx";
import BillingGate from "./components/BillingGate.jsx";
import LegalPage from "./components/LegalPage.jsx";
import ReportView from "./components/ReportView.jsx";
import { setDemoMode } from "./api.js";
import {
  demoTeams, demoTeamData, demoCycleIssues, demoIssueHistories,
  demoProjects, demoProjectIssues, demoAvailability,
} from "./demo-data.js";

const demoPayload = {
  teams: demoTeams,
  teamData: demoTeamData,
  cycleIssues: demoCycleIssues,
  issueHistories: demoIssueHistories,
  projects: demoProjects,
  projectIssues: demoProjectIssues,
  availability: demoAvailability,
};

function DemoApp() {
  setDemoMode(demoPayload);
  return <App demo />;
}

function AuthRoot() {
  const { auth } = useAuth();

  // Loading auth state
  if (auth === null) return null;

  // Standalone mode — no auth backend, render app directly
  if (auth === "standalone") return <App />;

  // Cloud mode — not logged in
  if (!auth.user) return <LoginPage />;

  // Cloud mode — no active subscription
  const { billing } = auth;
  if (!billing || billing.status === "none" || billing.status === "canceled" ||
      (billing.status === "trialing" && new Date(billing.trialEndsAt) < new Date())) {
    return <BillingGate />;
  }

  // Cloud mode — authenticated and subscribed
  return <App />;
}

function Root() {
  const [legalPage, setLegalPage] = useState(null);
  const [showDemo, setShowDemo] = useState(() => window.location.pathname === "/demo");
  const [reportToken, setReportToken] = useState(() => {
    const match = window.location.pathname.match(/^\/report\/(.+)$/);
    return match ? match[1] : null;
  });

  // Handle /privacy, /terms, and /report/:token URLs
  useEffect(() => {
    const path = window.location.pathname;
    if (path === "/privacy") setLegalPage("privacy");
    else if (path === "/terms") setLegalPage("terms");
    else if (path.startsWith("/report/")) setReportToken(path.split("/report/")[1]);
  }, []);

  // Expose navigation for links
  useEffect(() => {
    window.__showLegal = (page) => {
      setLegalPage(page);
      setShowDemo(false);
      window.history.pushState({}, "", `/${page}`);
    };
    window.__showDemo = () => {
      setShowDemo(true);
      setLegalPage(null);
      window.history.pushState({}, "", "/demo");
    };
    const handlePop = () => {
      const path = window.location.pathname;
      if (path === "/privacy") { setLegalPage("privacy"); setShowDemo(false); }
      else if (path === "/terms") { setLegalPage("terms"); setShowDemo(false); }
      else if (path === "/demo") { setShowDemo(true); setLegalPage(null); }
      else { setLegalPage(null); setShowDemo(false); }
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  if (reportToken) return <ReportView token={reportToken} />;

  if (legalPage) {
    return <LegalPage page={legalPage} onBack={() => {
      setLegalPage(null);
      window.history.pushState({}, "", "/");
    }} />;
  }

  // Demo mode — no auth needed, render directly
  if (showDemo) return <DemoApp />;

  // Normal mode — auth provider handles login/billing flow
  return (
    <AuthProvider>
      <AuthRoot />
    </AuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  </React.StrictMode>
);

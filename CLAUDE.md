# Linear Sprint Dashboard

## What This Is

A self-hosted web app for standup capacity planning. It connects to Linear's GraphQL API and shows:

1. **Capacity view** - Per-person breakdown of assigned story points vs capacity, with overload flags
2. **Burndown chart** - Cycle burndown (points or issue count) with ideal line and today marker
3. **Summary strip** - Total issues, assigned points, done points, progress %, team capacity, unestimated count

## Architecture

Single-page app with a thin backend proxy to avoid CORS issues (Linear's API doesn't allow browser cross-origin requests).

```
Browser (React SPA)  -->  Express proxy (/api/linear)  -->  api.linear.app/graphql
```

### Backend: Express server
- Serves the built React frontend as static files
- Single proxy endpoint `POST /api/linear` that forwards GraphQL queries to `https://api.linear.app/graphql`
- Reads `LINEAR_API_KEY` from environment variable, injects it as `Authorization` header
- No database, no session state, no auth layer needed (it's an internal tool)

### Frontend: React + Recharts
- Login screen if no API key is configured server-side (optional: can also accept key via UI for flexibility)
- Calls `/api/linear` instead of `api.linear.app` directly
- All state is client-side React state, nothing persisted

## Linear GraphQL API Details

**Endpoint:** `https://api.linear.app/graphql`  
**Auth:** `Authorization: <API_KEY>` header (personal API key, format `lin_api_...`)  
**Rate limits:** 1,500 requests/hour per user, 250,000 complexity points/hour

### Key Queries

#### 1. List teams
```graphql
query { teams { nodes { id name } } }
```

#### 2. Load team data (members, statuses, cycles with history)
```graphql
query TeamData($teamId: String!) {
  team(id: $teamId) {
    id
    name
    members { nodes { id name displayName email } }
    states { nodes { id name type position } }
    cycles(orderBy: createdAt) {
      nodes {
        id number name startsAt endsAt completedAt progress
        scopeHistory completedScopeHistory
        issueCountHistory completedIssueCountHistory
        inProgressScopeHistory
      }
    }
  }
}
```

#### 3. Load issues for a specific cycle
```graphql
query CycleIssues($cycleId: String!) {
  cycle(id: $cycleId) {
    issues {
      nodes {
        id identifier title priority estimate
        assignee { id name }
        state { id name type }
      }
    }
  }
}
```

#### 4. Load backlog issues (when no cycle is active)
```graphql
query BacklogIssues($teamId: String!) {
  team(id: $teamId) {
    issues(filter: { state: { type: { nin: ["completed", "canceled"] } } }, first: 250) {
      nodes {
        id identifier title priority estimate
        assignee { id name }
        state { id name type }
      }
    }
  }
}
```

### Cycle Burndown Data

Linear provides daily snapshot arrays on the Cycle object:
- `scopeHistory: [Float]` - Total estimation points after each day
- `completedScopeHistory: [Float]` - Completed estimation points after each day
- `issueCountHistory: [Float]` - Total issue count after each day
- `completedIssueCountHistory: [Float]` - Completed issue count after each day
- `inProgressScopeHistory: [Float]` - In-progress estimation points after each day

Each array index = one day from `startsAt`. The burndown "remaining" line is `scopeHistory[i] - completedScopeHistory[i]`. The ideal burndown is a straight line from `scopeHistory[0]` to 0 over `totalDays`.

### Issue State Types

Linear workflow states have a `type` field with these values:
- `backlog` - Not yet planned
- `unstarted` - Planned but not started (e.g., "Todo")
- `started` - In progress
- `completed` - Done
- `canceled` - Canceled/duplicate

### Issue Estimates

Estimates are a single `Float` on the issue. The scale depends on team config (linear, exponential, fibonacci, or t-shirt). T-shirt sizes map to fibonacci values internally. `null` means unestimated.

### Priority Values

- `0` = No priority
- `1` = Urgent
- `2` = High
- `3` = Normal (previously "Medium")
- `4` = Low

## Features to Implement

### Capacity Tab
- Group issues by assignee
- For each person show: initials avatar, name, counts (active/todo/done/unestimated), capacity bar (assigned pts / capacity limit)
- Capacity limits are configurable per person via a settings panel (default 15 pts)
- Flag people who are over capacity with a red badge
- List each issue under the person: status icon, identifier (e.g., TES-5), title, priority badge, estimate

### Burndown Tab
- Area chart showing remaining work over time (blue area with gradient)
- Dashed ideal burndown line
- "Today" reference line
- Toggle between points and issue count modes
- Below the chart: per-person capacity bars showing their load and done points

### Summary Strip
- Issues count, Assigned points, Done points, Progress %, Team Capacity, Unestimated count
- Color-code: red if over capacity, yellow for unestimated > 0, green for good progress

### Cycle Selector
- Pill buttons to switch between cycles
- Auto-select current cycle (startsAt <= now <= endsAt and not completed)
- Fallback to next upcoming, then most recent

### General
- Refresh button that re-fetches from Linear
- Dark theme (dark navy/charcoal background, not pure black)
- Monospace font for numbers/identifiers, sans-serif for labels
- Responsive layout

## Tech Stack Recommendation

- **Frontend:** React 18 + Vite + Recharts
- **Backend:** Express.js (minimal proxy)
- **Deployment:** Docker (single container, multi-stage build) or just `node server.js`
- **No database needed** - capacity settings can be stored in localStorage on the client

## Environment Variables

```
LINEAR_API_KEY=lin_api_xxxxx    # Required - Linear personal API key
PORT=3000                        # Optional - defaults to 3000
```

## File Structure

```
linear-dashboard/
  server.js              # Express server (proxy + static serving)
  package.json
  Dockerfile
  docker-compose.yml
  .env.example
  frontend/
    src/
      App.jsx            # Main dashboard component
      components/
        BurndownChart.jsx
        CapacityBar.jsx
        PersonCard.jsx
        SummaryStrip.jsx
        CycleSelector.jsx
        SettingsPanel.jsx
      api.js             # Fetch wrapper for /api/linear
      utils.js           # Status icons, priority labels, etc.
    index.html
    vite.config.js
    package.json
```

## Key Design Decisions

- The proxy is intentionally dumb - it just forwards GraphQL. No caching, no transformation. The frontend owns all logic.
- Capacity settings per person are stored in the browser's localStorage, keyed by team ID. This is fine for an internal standup tool.
- No auth on the dashboard itself. It runs on the local network. If you need auth, add basic auth middleware to Express.
- The API key has read access to everything the user can see in Linear. Don't expose this on the public internet.

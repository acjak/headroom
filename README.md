# Headroom

A self-hosted web app for standup capacity planning. Connects to Linear's GraphQL API and shows per-person workload, cycle burndown charts, and team capacity at a glance.

Built for big-screen standups — readable across the room.

## Features

- **Capacity view** — Per-person breakdown of assigned story points vs capacity, with overload flags
- **Burndown chart** — Cycle burndown (points or issue count) with ideal line and today marker
- **Availability calendar** — Click-to-toggle grid for marking full/half days off per person per cycle, capacity is computed from actual workdays
- **Summary strip** — Total issues, assigned points, done points, progress %, team capacity, unestimated count
- **Cycle selector** — Switch between cycles, auto-selects the current one
- **Dark/light theme** — Toggle in the header, persisted in localStorage
- **Collapsible cards** — Click a person card to expand/collapse their issue list
- **Issue links** — Issue titles link directly to Linear

## Architecture

Single-page app with a thin Express proxy to avoid CORS issues.

```
Browser (React SPA)  →  Express proxy (/api/linear)  →  api.linear.app/graphql
```

No database, no session state. Capacity settings and theme preference are stored in the browser's localStorage.

## Prerequisites

- Node.js 20+
- A Linear personal API key (get from Linear > Settings > Account > Security & Access > API)

## Quick Start

```bash
# Clone the repo
git clone <repo-url>
cd linear-dashboard

# Install dependencies
npm install
cd frontend && npm install && cd ..

# Create .env with your API key
cp .env.example .env
# Edit .env and set LINEAR_API_KEY=lin_api_your_key_here

# Build the frontend
npm run build

# Start the server
npm start
```

Open http://localhost:3000.

## Development

```bash
npm run dev
```

This runs the Express server (with `--watch`) and the Vite dev server concurrently. The Vite dev server proxies `/api` requests to the Express server.

## Docker

```bash
# Create .env with your API key
cp .env.example .env
# Edit .env and set LINEAR_API_KEY

# Build and run
docker compose up -d --build
```

The container exposes port 3000.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `LINEAR_API_KEY` | Yes | — | Linear personal API key (`lin_api_...`) |
| `PORT` | No | `3000` | Server port |

## How Capacity Works

When a cycle is active, capacity is derived from workdays:

1. The dashboard calculates all weekdays (Mon–Fri) in the cycle date range
2. You set a **points per day** rate (default: 2)
3. For each person, toggle days as **available**, **half day**, or **off**
4. Capacity = `(workdays - full_days_off - half_days × 0.5) × points_per_day`

Availability data is stored in localStorage per team and cycle, so each cycle has independent availability settings.

When no cycle is active (backlog view), capacity falls back to a simple number input per person.

## Tech Stack

- **Frontend:** React 18, Vite, Recharts
- **Backend:** Express (minimal GraphQL proxy)
- **Styling:** Inline styles with theme context (no CSS framework)

## Security Notes

- The API key is only stored server-side in the `.env` file and injected as an Authorization header by the Express proxy
- The frontend never sees or stores the API key
- `.env` is in `.gitignore` — never commit your API key
- This is designed for internal/local network use. If exposing to the internet, add authentication middleware to Express

## License

MIT

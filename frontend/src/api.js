export async function linearQuery(query, variables = {}) {
  const res = await fetch("/api/linear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Linear API returned ${res.status}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors.map((e) => e.message).join(", "));
  }
  return json.data;
}

// --- Queries ---

export const TEAMS_QUERY = `query { teams { nodes { id name } } }`;

export const TEAM_DATA_QUERY = `
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
`;

export const CYCLE_ISSUES_QUERY = `
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
`;

export const BACKLOG_ISSUES_QUERY = `
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
`;

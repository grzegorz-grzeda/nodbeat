// Polls the Dashboard JSON and rebuilds the table body with the same cells the server renders (dashboard.ts `row`),
// switching between the table and the empty state as Monitors come and go.
// Text goes in through textContent, so it never needs escaping. On 401 (logged out elsewhere) it reloads, landing on
// the login page.
(() => {
  const POLL_INTERVAL_MS = 5000;
  const body = document.getElementById("monitors");
  const table = document.getElementById("monitors-table");
  const empty = document.getElementById("empty-state");
  if (!body || !table || !empty) return;

  const cell = (text, attrs = {}) => {
    const td = document.createElement("td");
    td.textContent = text;
    for (const [k, v] of Object.entries(attrs)) td.setAttribute(k, v);
    return td;
  };

  const row = (m) => {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.className = "cell-name";
    const link = document.createElement("a");
    link.href = "/monitors/" + encodeURIComponent(m.id);
    link.textContent = m.name;
    name.append(link);
    const state = document.createElement("td");
    state.dataset.label = "State";
    const badge = document.createElement("span");
    badge.className = "badge badge-" + m.state;
    badge.textContent = m.stateText;
    state.append(badge);
    tr.append(
      name,
      state,
      cell(m.lastHeartbeatText, {
        "data-label": "Last Heartbeat",
        title: m.lastHeartbeatTitle,
      }),
      cell(m.lastMessage ?? "", { "data-label": "Last message" }),
      cell(m.uptime7dText, { "data-label": "7-day Uptime" }),
    );
    return tr;
  };

  const render = (monitors) => {
    empty.hidden = monitors.length > 0;
    table.hidden = monitors.length === 0;
    body.replaceChildren(...monitors.map(row));
  };

  const poll = async () => {
    try {
      const res = await fetch("/dashboard.json", {
        headers: { accept: "application/json" },
      });
      if (res.status === 401) return location.reload();
      if (res.ok) render((await res.json()).monitors);
    } catch {
      // Offline or nodbeat restarting: keep the last data and try again.
    }
    setTimeout(poll, POLL_INTERVAL_MS);
  };
  setTimeout(poll, POLL_INTERVAL_MS);
})();

// Polls the Dashboard JSON and rebuilds the table body with the same cells the server renders (dashboard.ts `row`).
// Text goes in through textContent, so it never needs escaping. On 401 (logged out elsewhere) it reloads, landing on
// the login page.
(() => {
  const POLL_INTERVAL_MS = 5000;
  const body = document.getElementById("monitors");
  if (!body) return;

  const cell = (text, attrs = {}) => {
    const td = document.createElement("td");
    td.textContent = text;
    for (const [k, v] of Object.entries(attrs)) td.setAttribute(k, v);
    return td;
  };

  const row = (m) => {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    const link = document.createElement("a");
    link.href = "/monitors/" + encodeURIComponent(m.id);
    link.textContent = m.name;
    name.append(link);
    const state = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge badge-" + m.state;
    badge.textContent = m.stateText;
    state.append(badge);
    tr.append(
      name,
      state,
      cell(m.lastHeartbeatText, { title: m.lastHeartbeatTitle }),
      cell(m.lastMessage ?? ""),
      cell(m.uptime7dText),
    );
    return tr;
  };

  const render = (monitors) => {
    if (monitors.length === 0) {
      const tr = document.createElement("tr");
      tr.append(cell("No Monitors yet.", { colspan: "5" }));
      body.replaceChildren(tr);
      return;
    }
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

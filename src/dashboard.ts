import type { FastifyInstance } from "fastify";
import type { Db, ObjectId } from "mongodb";
import { requireUser, type Auth } from "./auth.js";
import type { Clock } from "./clock.js";
import { formatAgo, formatDateTime } from "./format.js";
import { html, page, SafeHtml, userHeader } from "./html.js";
import { STATE_LABELS, type MonitorState } from "./monitor-state.js";
import { listMonitors } from "./monitors.js";
import { formatUptime, sevenDayUptime } from "./uptime.js";

/** One Monitor as the Dashboard JSON reports it. The `*Text` fields are ready to display. */
export interface DashboardMonitor {
  id: string;
  name: string;
  state: MonitorState;
  stateText: string;
  lastHeartbeatAt: string | null;
  /** "2 min ago" or "never". */
  lastHeartbeatText: string;
  /** The last Heartbeat's time in the User's time zone; empty if never. */
  lastHeartbeatTitle: string;
  lastMessage: string | null;
  /** 0..1, null when the Monitor was neither Up nor Down in the last 7 days. */
  uptime7d: number | null;
  uptime7dText: string;
}

const POLL_INTERVAL_MS = 5000;

async function dashboardMonitors(
  db: Db,
  user: { _id: ObjectId; timeZone: string },
  now: Date,
): Promise<DashboardMonitor[]> {
  const list = await listMonitors(db, user._id);
  return Promise.all(
    list.map(async (m) => {
      const uptime = await sevenDayUptime(db, m, now);
      return {
        id: String(m._id),
        name: m.name,
        state: m.state,
        stateText: STATE_LABELS[m.state],
        lastHeartbeatAt: m.lastHeartbeatAt?.toISOString() ?? null,
        lastHeartbeatText: formatAgo(m.lastHeartbeatAt, now),
        lastHeartbeatTitle: m.lastHeartbeatAt
          ? formatDateTime(m.lastHeartbeatAt, user.timeZone)
          : "",
        lastMessage: m.lastMessage,
        uptime7d: uptime,
        uptime7dText: formatUptime(uptime),
      };
    }),
  );
}

function row(m: DashboardMonitor): SafeHtml {
  return html`<tr>
    <td><a href="/monitors/${m.id}">${m.name}</a></td>
    <td class="state-${m.state}">${m.stateText}</td>
    <td title="${m.lastHeartbeatTitle}">${m.lastHeartbeatText}</td>
    <td>${m.lastMessage ?? ""}</td>
    <td>${m.uptime7dText}</td>
  </tr>`;
}

const EMPTY_ROW = html`<tr>
  <td colspan="5">No Monitors yet.</td>
</tr>`;

/**
 * Polls the Dashboard JSON and rebuilds the table body with the same cells `row` renders. Text goes in through
 * textContent, so it never needs escaping. On 401 (logged out elsewhere) it reloads, landing on the login page.
 */
const POLL_SCRIPT = new SafeHtml(`<script>
(() => {
  const body = document.getElementById("monitors");
  const cell = (text, attrs = {}) => {
    const td = document.createElement("td");
    td.textContent = text;
    for (const [k, v] of Object.entries(attrs)) td.setAttribute(k, v);
    return td;
  };
  const render = (monitors) => {
    if (monitors.length === 0) {
      const tr = document.createElement("tr");
      tr.append(cell("No Monitors yet.", { colspan: "5" }));
      body.replaceChildren(tr);
      return;
    }
    body.replaceChildren(...monitors.map((m) => {
      const tr = document.createElement("tr");
      const name = document.createElement("td");
      const link = document.createElement("a");
      link.href = "/monitors/" + encodeURIComponent(m.id);
      link.textContent = m.name;
      name.append(link);
      tr.append(
        name,
        cell(m.stateText, { class: "state-" + m.state }),
        cell(m.lastHeartbeatText, { title: m.lastHeartbeatTitle }),
        cell(m.lastMessage ?? ""),
        cell(m.uptime7dText),
      );
      return tr;
    }));
  };
  const poll = async () => {
    try {
      const res = await fetch("/dashboard.json", { headers: { accept: "application/json" } });
      if (res.status === 401) return location.reload();
      if (res.ok) render((await res.json()).monitors);
    } catch {
      // Offline or nodbeat restarting: keep the last data and try again.
    }
    setTimeout(poll, ${POLL_INTERVAL_MS});
  };
  setTimeout(poll, ${POLL_INTERVAL_MS});
})();
</script>`);

export function registerDashboard(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Auth },
): void {
  const { db, clock, auth } = deps;

  app.get("/", { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const list = await dashboardMonitors(db, user, clock.now());
    return reply.type("text/html").send(
      page({
        title: "Dashboard",
        header: userHeader(user.email, auth.csrfToken(req, reply)),
        body: html`<h1>Dashboard</h1>
          <p><a href="/monitors/new">New Monitor</a></p>
          <table>
            <thead>
              <tr>
                <th>Monitor</th>
                <th>State</th>
                <th>Last Heartbeat</th>
                <th>Last message</th>
                <th>7-day Uptime</th>
              </tr>
            </thead>
            <tbody id="monitors">
              ${list.length === 0 ? EMPTY_ROW : list.map(row)}
            </tbody>
          </table>
          ${POLL_SCRIPT}`,
      }),
    );
  });

  app.get("/dashboard.json", async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: "Not logged in" });
    const monitors = await dashboardMonitors(db, user, clock.now());
    return reply.header("cache-control", "no-store").send({ monitors });
  });
}

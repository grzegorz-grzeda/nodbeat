import type { FastifyInstance } from "fastify";
import type { Db, ObjectId } from "mongodb";
import { requireUser } from "./auth.js";
import type { Clock } from "./clock.js";
import { formatAgo, formatDateTime } from "./format.js";
import { html, type SafeHtml } from "./html.js";
import { stateBadge } from "./layout.js";
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
    <td>${stateBadge(m.state)}</td>
    <td title="${m.lastHeartbeatTitle}">${m.lastHeartbeatText}</td>
    <td>${m.lastMessage ?? ""}</td>
    <td>${m.uptime7dText}</td>
  </tr>`;
}

const EMPTY_ROW = html`<tr>
  <td colspan="5">No Monitors yet.</td>
</tr>`;

export function registerDashboard(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock },
): void {
  const { db, clock } = deps;

  app.get("/", { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const list = await dashboardMonitors(db, user, clock.now());
    return reply.page({
      title: "Dashboard",
      // Polls /dashboard.json and rebuilds the table body with the same cells `row` renders.
      scripts: ["dashboard.js"],
      body: html`<div class="page-head">
          <h1>Dashboard</h1>
          <a href="/monitors/new" class="button">New Monitor</a>
        </div>
        <div class="table-wrap">
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
        </div>`,
    });
  });

  app.get("/dashboard.json", async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: "Not logged in" });
    const monitors = await dashboardMonitors(db, user, clock.now());
    return reply.header("cache-control", "no-store").send({ monitors });
  });
}

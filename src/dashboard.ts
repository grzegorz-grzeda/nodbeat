import type { FastifyInstance } from "fastify";
import type { Db, ObjectId } from "mongodb";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";
import { formatAgo, formatDateTime, formatDurationOrEmpty } from "./format.js";
import { html, type SafeHtml } from "./html.js";
import { landingBody } from "./landing.js";
import { stateBadge } from "./layout.js";
import { STATE_LABELS, type MonitorState } from "./monitor-state.js";
import { listMonitors } from "./monitors.js";
import { formatUptime, sevenDayUptime } from "./uptime.js";
import { listAlertChannels } from "./alert-channels.js";
import { channelsOfMonitor } from "./monitor-alert-channels.js";

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
  /** The last finished Run's duration in seconds; null if none. */
  lastRunDurationSec: number | null;
  /** "42 s", or empty if no Run has ended. */
  lastRunDurationText: string;
  /** 0..1, null when the Monitor was neither Up nor Down in the last 7 days. */
  uptime7d: number | null;
  uptime7dText: string;
  /** The Monitor has no Alert channels: its Alerts go nowhere. */
  alertsGoNowhere: boolean;
}

async function dashboardMonitors(
  db: Db,
  user: { _id: ObjectId; timeZone: string },
  now: Date,
): Promise<DashboardMonitor[]> {
  const [list, channels] = await Promise.all([
    listMonitors(db, user._id),
    listAlertChannels(db, user._id),
  ]);
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
        lastRunDurationSec: m.lastRunDurationSec ?? null,
        lastRunDurationText: formatDurationOrEmpty(m.lastRunDurationSec),
        uptime7d: uptime,
        uptime7dText: formatUptime(uptime),
        alertsGoNowhere: channelsOfMonitor(m, channels).length === 0,
      };
    }),
  );
}

/** `data-label` heads each cell when the table turns into cards on a phone. */
function row(m: DashboardMonitor): SafeHtml {
  return html`<tr>
    <td class="cell-name">
      <a href="/monitors/${m.id}">${m.name}</a>
      ${m.alertsGoNowhere && html`<small class="warning">Alerts go nowhere</small>`}
    </td>
    <td data-label="State">${stateBadge(m.state)}</td>
    <td data-label="Last Heartbeat" title="${m.lastHeartbeatTitle}">
      ${m.lastHeartbeatText}
    </td>
    <td data-label="Last message">${m.lastMessage ?? ""}</td>
    <td data-label="Last Run">${m.lastRunDurationText}</td>
    <td data-label="7-day Uptime">${m.uptime7dText}</td>
  </tr>`;
}

export function registerDashboard(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; config: Config },
): void {
  const { db, clock, config } = deps;

  // A visitor without a session gets the landing page; a User's bookmark keeps working.
  app.get("/", async (req, reply) => {
    const user = req.user;
    if (!user) {
      return reply.page({
        title: "Uptime monitoring",
        body: landingBody(config.publicBaseUrl),
      });
    }
    const list = await dashboardMonitors(db, user, clock.now());
    return reply.page({
      title: "Dashboard",
      // Polls /dashboard.json and rebuilds the table body with the same cells `row` renders.
      scripts: ["dashboard.js"],
      // Both the empty state and the table are rendered; the poll toggles `hidden` as Monitors come and go.
      body: html`<div class="page-head">
          <h1>Dashboard</h1>
          <a href="/monitors/new" class="button">New Monitor</a>
        </div>
        <div
          class="card empty-state"
          id="empty-state"
          ${list.length > 0 && html`hidden`}
        >
          <h2>No Monitors yet.</h2>
          <p>
            A Monitor gets a Heartbeat URL. Send Heartbeats to it from a cron
            job, a service or a device, and nodbeat tells you when they stop.
          </p>
          <a href="/monitors/new" class="button">Create your first Monitor</a>
        </div>
        <div
          class="table-wrap"
          id="monitors-table"
          ${list.length === 0 && html`hidden`}
        >
          <table class="cards">
            <thead>
              <tr>
                <th>Monitor</th>
                <th>State</th>
                <th>Last Heartbeat</th>
                <th>Last message</th>
                <th>Last Run</th>
                <th>7-day Uptime</th>
              </tr>
            </thead>
            <tbody id="monitors">
              ${list.map(row)}
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

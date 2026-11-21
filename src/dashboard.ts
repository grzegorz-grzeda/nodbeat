import type { FastifyInstance } from "fastify";
import type { Db, ObjectId } from "mongodb";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";
import { formatAgo, formatDateTime, formatDurationOrEmpty } from "./format.js";
import { html } from "./html.js";
import type { InviteRequestForm } from "./invite-requests.js";
import { monitorsTable, type DashboardMonitor } from "./dashboard-table.js";
export type { DashboardMonitor } from "./dashboard-table.js";
import { landingBody } from "./landing.js";
import { STATE_LABELS } from "./monitor-state.js";
import { listMonitors, nextExpected } from "./monitors.js";
import { formatUptime, sevenDayUptime } from "./uptime.js";
import { listAlertChannels } from "./alert-channels.js";
import { channelsOfMonitor } from "./monitor-alert-channels.js";
import { unreachableNote } from "./monitor-parents.js";

async function dashboardMonitors(
  db: Db,
  user: { _id: ObjectId; timeZone: string },
  now: Date,
  startedAt: Date,
): Promise<DashboardMonitor[]> {
  const [list, channels] = await Promise.all([
    listMonitors(db, user._id),
    listAlertChannels(db, user._id),
  ]);
  const byId = new Map(list.map((m) => [String(m._id), m]));
  return Promise.all(
    list.map(async (m) => {
      const uptime = await sevenDayUptime(db, m, now);
      const due = nextExpected(m, startedAt, now, user.timeZone);
      return {
        id: String(m._id),
        name: m.name,
        state: m.state,
        stateText: STATE_LABELS[m.state],
        stateNote: unreachableNote(
          m,
          m.parentId ? byId.get(String(m.parentId)) : undefined,
        ),
        lastHeartbeatAt: m.lastHeartbeatAt?.toISOString() ?? null,
        lastHeartbeatText: formatAgo(m.lastHeartbeatAt, now),
        lastHeartbeatTitle: m.lastHeartbeatAt
          ? formatDateTime(m.lastHeartbeatAt, user.timeZone)
          : "",
        lastMessage: m.lastMessage,
        lastRunDurationSec: m.lastRunDurationSec ?? null,
        lastRunDurationText: formatDurationOrEmpty(m.lastRunDurationSec),
        nextExpectedAt: due.at?.toISOString() ?? null,
        nextExpectedText: due.text,
        uptime7d: uptime,
        uptime7dText: formatUptime(uptime),
        alertsGoNowhere: channelsOfMonitor(m, channels).length === 0,
      };
    }),
  );
}

export function registerDashboard(
  app: FastifyInstance,
  deps: {
    db: Db;
    clock: Clock;
    config: Config;
    /** When this nodbeat process started, for nextDueAt()'s startup grace. */
    startedAt: Date;
    /** The landing page's "Request an Invite" form; none when Invite requests are off. */
    inviteRequestForm: InviteRequestForm | undefined;
  },
): void {
  const { db, clock, config, startedAt, inviteRequestForm } = deps;

  // A visitor without a session gets the landing page; a User's bookmark keeps working.
  app.get("/", async (req, reply) => {
    const user = req.user;
    if (!user) {
      return reply.page({
        title: "Uptime monitoring",
        body: landingBody(
          config.publicBaseUrl,
          inviteRequestForm?.(req, reply),
        ),
      });
    }
    const list = await dashboardMonitors(db, user, clock.now(), startedAt);
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
          ${monitorsTable(list, "monitors")}
        </div>`,
    });
  });

  app.get("/dashboard.json", async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: "Not logged in" });
    const monitors = await dashboardMonitors(db, user, clock.now(), startedAt);
    return reply.header("cache-control", "no-store").send({ monitors });
  });
}

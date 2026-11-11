import type { FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import { requireAdmin } from "./auth.js";
import type { Clock } from "./clock.js";
import {
  countHeartbeatsByMonitorSince,
  summarizeHeartbeatTraffic,
} from "./heartbeats.js";
import { html, type SafeHtml } from "./html.js";
import { countIncidentsSince } from "./incidents.js";
import { formatDateTime } from "./format.js";
import { countLinkedChats, countLinkedChatsByOwner } from "./linked-chats.js";
import { STATE_LABELS, type MonitorState } from "./monitor-state.js";
import { instanceLimits } from "./limits.js";
import {
  countMonitorsByState,
  monitorsByOwner,
  summarizeMonitorSetup,
} from "./monitors.js";
import { listUserEmails } from "./users.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const STATES: MonitorState[] = ["new", "up", "down", "paused"];

/** A two-column table of labelled numbers. */
function statTable(caption: string, rows: Array<[string, number]>): SafeHtml {
  return html`<h2>${caption}</h2>
    <div class="table-wrap">
      <table class="stats">
        <tbody>
          ${rows.map(
            ([label, value]) =>
              html`<tr>
                <th scope="row">${label}</th>
                <td>${String(value)}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
}

/** A table of labelled counts of `unit` (e.g. "Monitors"), each with its share of `total`. */
function shareTable(
  caption: string,
  unit: string,
  total: number,
  rows: Array<[string, number]>,
): SafeHtml {
  const percent = (n: number) =>
    total === 0 ? "–" : `${String(Math.round((100 * n) / total))}%`;
  return html`<h2>${caption}</h2>
    <div class="table-wrap">
      <table class="stats">
        <thead>
          <tr>
            <th scope="col"></th>
            <th scope="col">${unit}</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            ([label, value]) =>
              html`<tr>
                <th scope="row">${label}</th>
                <td>${String(value)}</td>
                <td>${percent(value)}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
}

interface UserActivity {
  email: string;
  monitors: number;
  linkedChats: number;
  heartbeats7d: number;
  lastHeartbeatAt: Date | null;
}

/** One row per User, the most recent last Heartbeat first; Users without one last. */
async function listUserActivity(db: Db, since: Date): Promise<UserActivity[]> {
  const [users, owned, chats, heartbeats] = await Promise.all([
    listUserEmails(db),
    monitorsByOwner(db),
    countLinkedChatsByOwner(db),
    countHeartbeatsByMonitorSince(db, since),
  ]);
  const rows = users.map((u) => {
    const own = owned.get(String(u._id));
    const ids = own?.monitorIds ?? [];
    return {
      email: u.email,
      monitors: ids.length,
      linkedChats: chats.get(String(u._id)) ?? 0,
      heartbeats7d: ids.reduce(
        (sum, id) => sum + (heartbeats.get(String(id)) ?? 0),
        0,
      ),
      lastHeartbeatAt: own?.lastHeartbeatAt ?? null,
    };
  });
  const time = (r: UserActivity) => r.lastHeartbeatAt?.getTime() ?? -Infinity;
  return rows.sort((a, b) => time(b) - time(a));
}

function userTable(rows: UserActivity[], timeZone: string): SafeHtml {
  return html`<h2>Users</h2>
    <div class="table-wrap">
      <table class="stats">
        <thead>
          <tr>
            <th scope="col">User</th>
            <th scope="col">Monitors</th>
            <th scope="col">Linked chats</th>
            <th scope="col">Heartbeats (7 days)</th>
            <th scope="col">Last Heartbeat</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (r) =>
              html`<tr>
                <th scope="row">${r.email}</th>
                <td>${String(r.monitors)}</td>
                <td>${String(r.linkedChats)}</td>
                <td>${String(r.heartbeats7d)}</td>
                <td>
                  ${
                    r.lastHeartbeatAt
                      ? formatDateTime(r.lastHeartbeatAt, timeZone)
                      : "never"
                  }
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
}

/**
 * The Admin's usage page: numbers for the whole instance and User emails; never Monitor names, notes, Heartbeat
 * messages or IPs.
 */
export function registerAdmin(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock },
): void {
  const { db, clock } = deps;

  app.get("/admin", { preHandler: requireAdmin }, async (req, reply) => {
    const nowMs = clock.now().getTime();
    const daysAgo = (days: number) => new Date(nowMs - days * DAY_MS);
    const [
      userActivity,
      byState,
      setup,
      chats,
      traffic,
      incidents7d,
      incidents30d,
    ] = await Promise.all([
      listUserActivity(db, daysAgo(7)),
      countMonitorsByState(db),
      // Per-User limits are the same for everyone until Plans exist.
      summarizeMonitorSetup(db, instanceLimits(), new Date(nowMs)),
      countLinkedChats(db),
      summarizeHeartbeatTraffic(db, daysAgo(7)),
      countIncidentsSince(db, daysAgo(7)),
      countIncidentsSince(db, daysAgo(30)),
    ]);
    const monitorCount = STATES.reduce((sum, s) => sum + byState[s], 0);

    return reply.page({
      title: "Admin",
      body: html`<h1>Admin</h1>
        <p>
          Usage of this nodbeat instance. Counts and User emails only: nothing
          here shows what Users watch.
        </p>
        <p><a href="/admin/invites">Invites</a></p>
        ${statTable("Totals", [
          ["Users", userActivity.length],
          ["Monitors", monitorCount],
          ["Linked chats", chats],
          ["Heartbeats (7 days)", traffic.total],
          ["Incidents (7 days)", incidents7d],
          ["Incidents (30 days)", incidents30d],
        ])}
        ${statTable(
          "Monitors by state",
          STATES.map((s) => [STATE_LABELS[s], byState[s]]),
        )}
        ${shareTable(
          "Monitors by Interval or Schedule",
          "Monitors",
          setup.total,
          setup.byInterval.map((g) => [g.label, g.count]),
        )}
        ${shareTable("Monitor settings", "Monitors", setup.total, [
          ["Custom Grace period", setup.customGrace],
          ["With notes", setup.withNotes],
          ["Alerts off", setup.alertsOff],
          ["Paused", setup.paused],
        ])}
        ${shareTable(
          "Heartbeat methods (7 days)",
          "Heartbeats",
          traffic.total,
          [
            ["GET", traffic.get],
            ["POST", traffic.post],
            ["With a message", traffic.withMessage],
          ],
        )}
        ${shareTable(
          "Heartbeat clients (7 days)",
          "Heartbeats",
          traffic.total,
          traffic.byClient.map((c) => [c.label, c.count]),
        )}
        ${userTable(userActivity, req.user!.timeZone)}`,
    });
  });
}

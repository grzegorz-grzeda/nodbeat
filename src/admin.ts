import type { FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import { requireAdmin } from "./auth.js";
import type { Clock } from "./clock.js";
import { countAllHeartbeatsSince } from "./heartbeats.js";
import { html, type SafeHtml } from "./html.js";
import { countIncidentsSince } from "./incidents.js";
import { countLinkedChats } from "./linked-chats.js";
import { STATE_LABELS, type MonitorState } from "./monitor-state.js";
import { instanceLimits } from "./limits.js";
import { countMonitorsByState, summarizeMonitorSetup } from "./monitors.js";
import { countUsers } from "./users.js";

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

/** A table of labelled Monitor counts, each with its share of all `total` Monitors. */
function monitorShareTable(
  caption: string,
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
            <th scope="col">Monitors</th>
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

/**
 * The Admin's usage page: numbers for the whole instance. Counts only; never Monitor names, notes, Heartbeat
 * messages or IPs.
 */
export function registerAdmin(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock },
): void {
  const { db, clock } = deps;

  app.get("/admin", { preHandler: requireAdmin }, async (_req, reply) => {
    const nowMs = clock.now().getTime();
    const daysAgo = (days: number) => new Date(nowMs - days * DAY_MS);
    const [
      users,
      byState,
      setup,
      chats,
      heartbeats7d,
      incidents7d,
      incidents30d,
    ] = await Promise.all([
      countUsers(db),
      countMonitorsByState(db),
      // Per-User limits are the same for everyone until Plans exist.
      summarizeMonitorSetup(db, instanceLimits()),
      countLinkedChats(db),
      countAllHeartbeatsSince(db, daysAgo(7)),
      countIncidentsSince(db, daysAgo(7)),
      countIncidentsSince(db, daysAgo(30)),
    ]);
    const monitorCount = STATES.reduce((sum, s) => sum + byState[s], 0);

    return reply.page({
      title: "Admin",
      body: html`<h1>Admin</h1>
        <p>
          Usage of this nodbeat instance. Counts only: nothing here shows what
          Users watch.
        </p>
        ${statTable("Totals", [
          ["Users", users],
          ["Monitors", monitorCount],
          ["Linked chats", chats],
          ["Heartbeats (7 days)", heartbeats7d],
          ["Incidents (7 days)", incidents7d],
          ["Incidents (30 days)", incidents30d],
        ])}
        ${statTable(
          "Monitors by state",
          STATES.map((s) => [STATE_LABELS[s], byState[s]]),
        )}
        ${monitorShareTable(
          "Monitors by Interval",
          setup.total,
          setup.byInterval.map((g) => [g.label, g.count]),
        )}
        ${monitorShareTable("Monitor settings", setup.total, [
          ["Custom Grace period", setup.customGrace],
          ["With notes", setup.withNotes],
          ["Alerts off", setup.alertsOff],
          ["Paused", setup.paused],
        ])}`,
    });
  });
}

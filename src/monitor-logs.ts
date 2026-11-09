import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "mongodb";
import { requireUser } from "./auth.js";
import type { Clock } from "./clock.js";
import { listHeartbeatsSince } from "./heartbeats.js";
import { html, type SafeHtml } from "./html.js";
import { listIncidents } from "./incidents.js";
import { instanceLimits } from "./limits.js";
import {
  heartbeatRetentionText,
  heartbeatsTable,
  heartbeatWindowStart,
  incidentsTable,
} from "./log-tables.js";
import {
  findOwnMonitor,
  sendMonitorNotFound,
  type MonitorDoc,
} from "./monitors.js";

type LogRequest = FastifyRequest<{ Params: { id: string } }>;

/**
 * The full Incident and Heartbeat logs of a Monitor, newest first. A Monitor keeps at most `maxLogRowsPerMonitor` of
 * each (see `src/log-pruner.ts`), so one page holds everything.
 */
export function registerMonitorLogs(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock },
): void {
  const { db, clock } = deps;
  const rows = instanceLimits().maxLogRowsPerMonitor;

  const logPage = async (
    req: LogRequest,
    reply: FastifyReply,
    log: {
      heading: string;
      /** The table, or null when the log is empty. */
      table: (
        monitor: MonitorDoc,
        now: Date,
        timeZone: string,
      ) => Promise<SafeHtml | null>;
      empty: string;
    },
  ) => {
    const monitor = await findOwnMonitor(db, req.user!._id, req.params.id);
    if (!monitor) return sendMonitorNotFound(reply);
    const base = `/monitors/${String(monitor._id)}`;
    const table = await log.table(monitor, clock.now(), req.user!.timeZone);
    return reply.page({
      title: `${log.heading} · ${monitor.name}`,
      body: html`<p><a href="${base}">← ${monitor.name}</a></p>
        <h1>${log.heading}</h1>
        ${table ?? html`<p>${log.empty}</p>`}`,
    });
  };

  app.get<{ Params: { id: string } }>(
    "/monitors/:id/incidents",
    { preHandler: requireUser },
    (req, reply) =>
      logPage(req, reply, {
        heading: `Incidents (newest ${rows})`,
        table: async (monitor, now, timeZone) => {
          const list = await listIncidents(db, monitor._id, rows);
          return list.length ? incidentsTable(list, now, timeZone) : null;
        },
        empty: "No Incidents yet.",
      }),
  );

  app.get<{ Params: { id: string } }>(
    "/monitors/:id/heartbeats",
    { preHandler: requireUser },
    (req, reply) =>
      logPage(req, reply, {
        heading: `Heartbeats (newest ${rows}, last ${heartbeatRetentionText()})`,
        table: async (monitor, now, timeZone) => {
          const list = await listHeartbeatsSince(
            db,
            monitor._id,
            heartbeatWindowStart(now),
            rows,
          );
          return list.length ? heartbeatsTable(list, timeZone) : null;
        },
        empty: `No Heartbeats in the last ${heartbeatRetentionText()}.`,
      }),
  );
}

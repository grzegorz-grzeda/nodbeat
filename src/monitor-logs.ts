import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db, ObjectId } from "mongodb";
import { requireUser } from "./auth.js";
import type { Clock } from "./clock.js";
import { countHeartbeatsSince, listHeartbeatsSince } from "./heartbeats.js";
import { html, type SafeHtml } from "./html.js";
import { countIncidents, listIncidents } from "./incidents.js";
import {
  heartbeatRetentionText,
  heartbeatsTable,
  heartbeatWindowStart,
  incidentsTable,
  LOG_PAGE_ROWS,
} from "./log-tables.js";
import { findOwnMonitor, sendMonitorNotFound } from "./monitors.js";

type LogRequest = FastifyRequest<{
  Params: { id: string };
  Querystring: { page?: string };
}>;

/** `?page=` as a page number from 1; anything else is page 1. */
function pageNumber(req: LogRequest): number {
  const page = Number(req.query.page);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

function pager(base: string, page: number, pages: number): SafeHtml {
  if (pages <= 1) return html``;
  return html`<p class="actions">
    ${page > 1 ? html`<a href="${base}?page=${page - 1}">← Newer</a>` : ""}
    <span>Page ${page} of ${pages}</span>
    ${page < pages ? html`<a href="${base}?page=${page + 1}">Older →</a>` : ""}
  </p>`;
}

/** The full Incident and Heartbeat logs of a Monitor, newest first, a page at a time. */
export function registerMonitorLogs(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock },
): void {
  const { db, clock } = deps;

  const logPage = async (
    req: LogRequest,
    reply: FastifyReply,
    log: {
      path: string;
      heading: string;
      count: (monitorId: ObjectId, now: Date) => Promise<number>;
      table: (
        monitorId: ObjectId,
        skip: number,
        now: Date,
        timeZone: string,
      ) => Promise<SafeHtml>;
      empty: string;
    },
  ) => {
    const monitor = await findOwnMonitor(db, req.user!._id, req.params.id);
    if (!monitor) return sendMonitorNotFound(reply);
    const now = clock.now();
    const total = await log.count(monitor._id, now);
    const pages = Math.max(1, Math.ceil(total / LOG_PAGE_ROWS));
    const page = pageNumber(req);
    if (page > pages) return reply.errorPage(404);
    const base = `/monitors/${String(monitor._id)}`;
    const heading = log.heading;
    const table = await log.table(
      monitor._id,
      (page - 1) * LOG_PAGE_ROWS,
      now,
      req.user!.timeZone,
    );
    return reply.page({
      title: `${heading} · ${monitor.name}`,
      body: html`<p><a href="${base}">← ${monitor.name}</a></p>
        <h1>${heading}</h1>
        ${
          total === 0
            ? html`<p>${log.empty}</p>`
            : html`${pager(base + log.path, page, pages)} ${table}
              ${pager(base + log.path, page, pages)}`
        }`,
    });
  };

  app.get<{ Params: { id: string }; Querystring: { page?: string } }>(
    "/monitors/:id/incidents",
    { preHandler: requireUser },
    (req, reply) =>
      logPage(req, reply, {
        path: "/incidents",
        heading: "Incidents",
        count: (id) => countIncidents(db, id),
        table: async (id, skip, now, timeZone) =>
          incidentsTable(
            await listIncidents(db, id, LOG_PAGE_ROWS, skip),
            now,
            timeZone,
          ),
        empty: "No Incidents yet.",
      }),
  );

  app.get<{ Params: { id: string }; Querystring: { page?: string } }>(
    "/monitors/:id/heartbeats",
    { preHandler: requireUser },
    (req, reply) =>
      logPage(req, reply, {
        path: "/heartbeats",
        heading: `Heartbeats (last ${heartbeatRetentionText()})`,
        count: (id, now) =>
          countHeartbeatsSince(db, id, heartbeatWindowStart(now)),
        table: async (id, skip, now, timeZone) =>
          heartbeatsTable(
            await listHeartbeatsSince(
              db,
              id,
              heartbeatWindowStart(now),
              LOG_PAGE_ROWS,
              skip,
            ),
            timeZone,
          ),
        empty: `No Heartbeats in the last ${heartbeatRetentionText()}.`,
      }),
  );
}

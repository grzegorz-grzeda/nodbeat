import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ObjectId, type Db } from "mongodb";
import { requireUser, type Auth } from "./auth.js";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";
import { parseObjectId } from "./ids.js";
import { formatDateTime, formatDuration } from "./format.js";
import { listHeartbeatsSince, type HeartbeatDoc } from "./heartbeats.js";
import { listIncidents, type IncidentDoc } from "./incidents.js";
import { csrfField, html, type SafeHtml } from "./html.js";
import { stateBadge } from "./layout.js";
import { monitorFormBody, readForm, validate } from "./monitor-form.js";
import {
  instanceLimits,
  limitsFor,
  MAX_HEARTBEAT_MESSAGE_LENGTH,
} from "./limits.js";
import type { MonitorStateFields } from "./monitor-state.js";
import { startPeriod } from "./state-periods.js";

export interface MonitorDoc extends MonitorStateFields {
  _id: ObjectId;
  ownerId: ObjectId;
  name: string;
  notes: string;
  intervalSec: number;
  graceSec: number;
  /** Secret part of the Heartbeat URL. */
  token: string;
  alertsEnabled: boolean;
  createdAt: Date;
}

/** Rows shown on the Monitor page, capped so a chatty or flaky Monitor doesn't produce a huge page. */
const HEARTBEAT_HISTORY_LIMIT = 500;
const INCIDENT_HISTORY_LIMIT = 100;

export const monitors = (db: Db) => db.collection<MonitorDoc>("monitors");

export async function ensureMonitorIndexes(db: Db): Promise<void> {
  await Promise.all([
    monitors(db).createIndex({ token: 1 }, { unique: true }),
    monitors(db).createIndex({ ownerId: 1, createdAt: 1 }),
  ]);
}

/** 192 random bits: unguessable, URL-safe. */
export const newHeartbeatToken = () => randomBytes(24).toString("base64url");

export function listMonitors(db: Db, ownerId: ObjectId): Promise<MonitorDoc[]> {
  return monitors(db).find({ ownerId }).sort({ createdAt: 1 }).toArray();
}

/** The owner's Monitor with this id, or null (also for another User's Monitor or a malformed id). */
export async function findOwnMonitor(
  db: Db,
  ownerId: ObjectId,
  id: string,
): Promise<MonitorDoc | null> {
  const _id = parseObjectId(id);
  return _id ? monitors(db).findOne({ _id, ownerId }) : null;
}

export function sendMonitorNotFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).page({
    title: "Not found",
    body: html`<h1>Not found</h1>
      <p class="error">No such Monitor.</p>
      <p><a href="/">Back to the Dashboard</a></p>`,
  });
}

export function registerMonitors(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; config: Config; auth: Auth },
): void {
  const { db, clock, config, auth } = deps;

  const heartbeatUrl = (monitor: MonitorDoc) =>
    `${config.publicBaseUrl}/hb/${monitor.token}`;

  app.get("/monitors/new", { preHandler: requireUser }, async (req, reply) =>
    reply.page({
      title: "New Monitor",
      body: monitorFormBody({
        csrf: auth.csrfToken(req, reply),
        form: readForm({}),
        limits: limitsFor(req.user!),
      }),
    }),
  );

  app.post("/monitors", { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const limits = limitsFor(user);
    const form = readForm(req.body);
    const result = validate(form, limits);
    const errors = "errors" in result ? result.errors : [];
    if (
      errors.length === 0 &&
      (await monitors(db).countDocuments({ ownerId: user._id })) >=
        limits.maxMonitors
    ) {
      errors.push(`You can have at most ${limits.maxMonitors} Monitors.`);
    }
    if (errors.length > 0 || !("settings" in result)) {
      return reply.code(400).page({
        title: "New Monitor",
        body: monitorFormBody({
          csrf: auth.csrfToken(req, reply),
          form,
          limits,
          errors,
        }),
      });
    }

    const monitor: MonitorDoc = {
      _id: new ObjectId(),
      ownerId: user._id,
      ...result.settings,
      state: "new",
      token: newHeartbeatToken(),
      alertsEnabled: true,
      lastHeartbeatAt: null,
      lastMessage: null,
      pausedAt: null,
      watchedSince: null,
      createdAt: clock.now(),
    };
    await monitors(db).insertOne(monitor);
    await startPeriod(db, "new", monitor, monitor.createdAt);
    return reply.redirect(`/monitors/${monitor._id}`, 303);
  });

  app.get<{ Params: { id: string } }>(
    "/monitors/:id",
    { preHandler: requireUser },
    async (req, reply) => {
      const monitor = await findOwnMonitor(db, req.user!._id, req.params.id);
      if (!monitor) return sendMonitorNotFound(reply);
      const url = heartbeatUrl(monitor);
      const now = clock.now();
      const [incidentList, heartbeatList] = await Promise.all([
        listIncidents(db, monitor._id, INCIDENT_HISTORY_LIMIT),
        listHeartbeatsSince(
          db,
          monitor._id,
          new Date(
            now.getTime() - instanceLimits().heartbeatRetentionSec * 1000,
          ),
          HEARTBEAT_HISTORY_LIMIT,
        ),
      ]);
      const timeZone = req.user!.timeZone;
      const csrf = auth.csrfToken(req, reply);
      return reply.page({
        title: monitor.name,
        body: html`<p><a href="/">← Dashboard</a></p>
          <div class="title-row">
            <h1>${monitor.name}</h1>
            ${stateBadge(monitor.state)}
          </div>
          ${actionsSection(monitor, csrf)}
          <div class="card">
            <form
              class="actions"
              method="post"
              action="/monitors/${String(monitor._id)}/alerts"
            >
              ${csrfField(csrf)}
              <span
                >Alerts:
                <strong>${monitor.alertsEnabled ? "on" : "off"}</strong></span
              >
              <input
                type="hidden"
                name="alertsEnabled"
                value="${monitor.alertsEnabled ? "false" : "true"}"
              />
              <button type="submit" class="secondary">
                ${monitor.alertsEnabled ? "Turn Alerts off" : "Turn Alerts on"}
              </button>
            </form>
            <ul class="plain">
              <li>Interval: ${formatDuration(monitor.intervalSec)}</li>
              <li>Grace period: ${formatDuration(monitor.graceSec)}</li>
            </ul>
            ${monitor.notes ? html`<p class="notes">${monitor.notes}</p>` : ""}
          </div>
          ${incidentsSection(incidentList, now, timeZone)}
          ${heartbeatsSection(heartbeatList, timeZone)}
          <h2>Heartbeat URL</h2>
          <p>
            Anyone who knows this URL can send Heartbeats for this Monitor. Keep
            it secret.
          </p>
          <input
            type="text"
            readonly
            value="${url}"
            aria-label="Heartbeat URL"
          />
          <form
            class="actions"
            method="post"
            action="/monitors/${String(monitor._id)}/regenerate-url"
          >
            ${csrfField(csrf)}
            <button type="submit" class="secondary">Regenerate URL</button>
            <small>The current URL stops working.</small>
          </form>
          <h2>Examples</h2>
          <p>
            Send a GET or POST. An optional message (up to
            ${MAX_HEARTBEAT_MESSAGE_LENGTH} characters) goes in the
            <code>msg</code> query parameter or the request body.
          </p>
          <h3>curl</h3>
          <pre><code>curl -fsS -m 10 --retry 3 ${url}
curl -fsS -m 10 --retry 3 --data-raw "battery 3.7V" ${url}</code></pre>
          <h3>cron</h3>
          <pre><code># crontab -e: run the job, then send a Heartbeat if it succeeded
*/5 * * * * /path/to/job.sh &amp;&amp; curl -fsS -m 10 --retry 3 ${url} &gt; /dev/null</code></pre>
          <h3>ESP32 / Arduino</h3>
          <pre><code>#include &lt;WiFi.h&gt;
#include &lt;WiFiClientSecure.h&gt;
#include &lt;HTTPClient.h&gt;

void sendHeartbeat(const String&amp; message) {
  WiFiClientSecure client;
  client.setInsecure(); // or client.setCACert(rootCA) to verify the server
  HTTPClient http;
  http.begin(client, "${url}");
  http.addHeader("Content-Type", "text/plain");
  int code = http.POST(message); // 200 = accepted
  http.end();
}</code></pre>`,
      });
    },
  );
}

/** Edit and Delete links and the Pause/Unpause button. */
function actionsSection(monitor: MonitorDoc, csrf: string): SafeHtml {
  const base = `/monitors/${String(monitor._id)}`;
  const paused = monitor.state === "paused";
  return html`<div class="actions">
    <a href="${base}/edit">Edit</a>
    <a href="${base}/delete">Delete</a>
    <form method="post" action="${base}/${paused ? "unpause" : "pause"}">
      ${csrfField(csrf)}
      <button type="submit" class="secondary">
        ${paused ? "Unpause" : "Pause"}
      </button>
    </form>
  </div>`;
}

function incidentsSection(
  list: IncidentDoc[],
  now: Date,
  timeZone: string,
): SafeHtml {
  if (list.length === 0) {
    return html`<h2>Incidents</h2>
      <p>No Incidents yet.</p>`;
  }
  return html`<h2>Incidents</h2>
    ${
      list.length === INCIDENT_HISTORY_LIMIT
        ? html`<p>Showing the latest ${INCIDENT_HISTORY_LIMIT}.</p>`
        : ""
    }
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Start</th>
            <th>End</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(
            (i) =>
              html`<tr>
                <td>${formatDateTime(i.startedAt, timeZone)}</td>
                <td>
                  ${i.endedAt ? formatDateTime(i.endedAt, timeZone) : "ongoing"}
                  ${i.endReason === "paused" ? "(paused)" : ""}
                </td>
                <td>
                  ${formatDuration(
                    ((i.endedAt ?? now).getTime() - i.startedAt.getTime()) /
                      1000,
                  )}
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
}

function heartbeatsSection(list: HeartbeatDoc[], timeZone: string): SafeHtml {
  const days = formatDuration(instanceLimits().heartbeatRetentionSec);
  const heading = html`<h2>Heartbeats (last ${days})</h2>`;
  if (list.length === 0) {
    return html`${heading}
      <p>No Heartbeats in the last ${days}.</p>`;
  }
  return html`${heading}
    ${
      list.length === HEARTBEAT_HISTORY_LIMIT
        ? html`<p>Showing the latest ${HEARTBEAT_HISTORY_LIMIT}.</p>`
        : ""
    }
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Received</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(
            (h) =>
              html`<tr>
                <td>${formatDateTime(h.receivedAt, timeZone)}</td>
                <td>${h.message ?? ""}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
}

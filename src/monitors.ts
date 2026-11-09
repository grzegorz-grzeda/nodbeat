import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ObjectId, type Db } from "mongodb";
import { requireUser, type Auth } from "./auth.js";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";
import { formatDateTime, formatDuration } from "./format.js";
import { listHeartbeatsSince, type HeartbeatDoc } from "./heartbeats.js";
import { listIncidents, type IncidentDoc } from "./incidents.js";
import { csrfField, html, page, userHeader, type SafeHtml } from "./html.js";
import {
  instanceLimits,
  limitsFor,
  MAX_HEARTBEAT_MESSAGE_LENGTH,
  type Limits,
} from "./limits.js";
import { STATE_LABELS, type MonitorStateFields } from "./monitor-state.js";

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
  pausedAt: Date | null;
  createdAt: Date;
}

const MAX_NAME_LENGTH = 100;
const MAX_NOTES_LENGTH = 2000;
/** Rows shown on the Monitor page, capped so a chatty or flaky Monitor doesn't produce a huge page. */
const HEARTBEAT_HISTORY_LIMIT = 500;
const INCIDENT_HISTORY_LIMIT = 100;
const UNIT_SEC = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 } as const;
type Unit = keyof typeof UNIT_SEC;

export const monitors = (db: Db) => db.collection<MonitorDoc>("monitors");

export async function ensureMonitorIndexes(db: Db): Promise<void> {
  await Promise.all([
    monitors(db).createIndex({ token: 1 }, { unique: true }),
    monitors(db).createIndex({ ownerId: 1, createdAt: 1 }),
  ]);
}

/** 192 random bits: unguessable, URL-safe. */
const newHeartbeatToken = () => randomBytes(24).toString("base64url");

export function listMonitors(db: Db, ownerId: ObjectId): Promise<MonitorDoc[]> {
  return monitors(db).find({ ownerId }).sort({ createdAt: 1 }).toArray();
}

/** The owner's Monitor with this id, or null (also for another User's Monitor or a malformed id). */
async function findOwnMonitor(
  db: Db,
  ownerId: ObjectId,
  id: string,
): Promise<MonitorDoc | null> {
  if (!ObjectId.isValid(id) || String(new ObjectId(id)) !== id) return null;
  return monitors(db).findOne({ _id: new ObjectId(id), ownerId });
}

interface MonitorForm {
  name: string;
  interval: string;
  intervalUnit: string;
  grace: string;
  graceUnit: string;
  notes: string;
}

interface MonitorSettings {
  name: string;
  notes: string;
  intervalSec: number;
  graceSec: number;
}

function readForm(body: unknown): MonitorForm {
  const b = (body ?? {}) as Record<string, unknown>;
  const field = (name: string) =>
    typeof b[name] === "string" ? (b[name] as string) : "";
  return {
    name: field("name"),
    interval: field("interval"),
    intervalUnit: field("intervalUnit") || "s",
    grace: field("grace"),
    graceUnit: field("graceUnit") || "s",
    notes: field("notes"),
  };
}

function toSeconds(value: string, unit: string): number | null {
  if (!/^\d+$/.test(value.trim()) || !(unit in UNIT_SEC)) return null;
  return Number(value.trim()) * UNIT_SEC[unit as Unit];
}

function validate(
  form: MonitorForm,
  limits: Limits,
): { settings: MonitorSettings } | { errors: string[] } {
  const errors: string[] = [];
  const name = form.name.trim();
  const notes = form.notes.trim();
  if (!name) errors.push("Name is required.");
  if (name.length > MAX_NAME_LENGTH) {
    errors.push(`Name can be at most ${MAX_NAME_LENGTH} characters.`);
  }
  if (notes.length > MAX_NOTES_LENGTH) {
    errors.push(`Notes can be at most ${MAX_NOTES_LENGTH} characters.`);
  }

  const intervalSec = toSeconds(form.interval, form.intervalUnit);
  if (
    intervalSec === null ||
    intervalSec < limits.minIntervalSec ||
    intervalSec > limits.maxIntervalSec
  ) {
    errors.push(
      `Interval must be between ${formatDuration(limits.minIntervalSec)} and ${formatDuration(limits.maxIntervalSec)}.`,
    );
  }

  let graceSec: number | null;
  if (form.grace.trim() === "") {
    graceSec = intervalSec === null ? null : Math.floor(intervalSec / 2);
    // Half of a long Interval can exceed the Grace bound (7 d → 3.5 d > 1 d); clamp rather than blame a field left blank.
    if (graceSec !== null) graceSec = Math.min(graceSec, limits.maxGraceSec);
  } else {
    graceSec = toSeconds(form.grace, form.graceUnit);
    if (
      graceSec === null ||
      graceSec < limits.minGraceSec ||
      graceSec > limits.maxGraceSec
    ) {
      errors.push(
        `Grace period must be between ${formatDuration(limits.minGraceSec)} and ${formatDuration(limits.maxGraceSec)}.`,
      );
    }
  }

  if (errors.length > 0 || intervalSec === null || graceSec === null) {
    return { errors };
  }
  return { settings: { name, notes, intervalSec, graceSec } };
}

export function registerMonitors(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; config: Config; auth: Auth },
): void {
  const { db, clock, config, auth } = deps;

  const heartbeatUrl = (monitor: MonitorDoc) =>
    `${config.publicBaseUrl}/hb/${monitor.token}`;

  app.get("/monitors/new", { preHandler: requireUser }, async (req, reply) =>
    reply.type("text/html").send(
      page({
        title: "New Monitor",
        header: userHeader(req.user!.email, auth.csrfToken(req, reply)),
        body: monitorFormBody({
          csrf: auth.csrfToken(req, reply),
          form: readForm({}),
          limits: limitsFor(req.user!),
        }),
      }),
    ),
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
      return reply
        .code(400)
        .type("text/html")
        .send(
          page({
            title: "New Monitor",
            header: userHeader(user.email, auth.csrfToken(req, reply)),
            body: monitorFormBody({
              csrf: auth.csrfToken(req, reply),
              form,
              limits,
              errors,
            }),
          }),
        );
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
      createdAt: clock.now(),
    };
    await monitors(db).insertOne(monitor);
    return reply.redirect(`/monitors/${monitor._id}`, 303);
  });

  app.get<{ Params: { id: string } }>(
    "/monitors/:id",
    { preHandler: requireUser },
    async (req, reply) => {
      const monitor = await findOwnMonitor(db, req.user!._id, req.params.id);
      if (!monitor) {
        return reply
          .code(404)
          .type("text/html")
          .send(
            page({
              title: "Not found",
              header: userHeader(req.user!.email, auth.csrfToken(req, reply)),
              body: html`<p class="error">No such Monitor.</p>
                <p><a href="/">Back to the Dashboard</a></p>`,
            }),
          );
      }
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
      return reply.type("text/html").send(
        page({
          title: monitor.name,
          header: userHeader(req.user!.email, auth.csrfToken(req, reply)),
          body: html`<p><a href="/">← Dashboard</a></p>
            <h1>${monitor.name}</h1>
            <p>State: <strong>${STATE_LABELS[monitor.state]}</strong></p>
            <ul>
              <li>Interval: ${formatDuration(monitor.intervalSec)}</li>
              <li>Grace period: ${formatDuration(monitor.graceSec)}</li>
            </ul>
            ${monitor.notes ? html`<p class="notes">${monitor.notes}</p>` : ""}
            ${incidentsSection(incidentList, now, timeZone)}
            ${heartbeatsSection(heartbeatList, timeZone)}
            <h2>Heartbeat URL</h2>
            <p>
              Anyone who knows this URL can send Heartbeats for this Monitor.
              Keep it secret.
            </p>
            <input
              type="text"
              readonly
              value="${url}"
              size="70"
              onfocus="this.select()"
            />
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
        }),
      );
    },
  );
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
              </td>
              <td>
                ${formatDuration(
                  ((i.endedAt ?? now).getTime() - i.startedAt.getTime()) / 1000,
                )}
              </td>
            </tr>`,
        )}
      </tbody>
    </table>`;
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
    </table>`;
}

function monitorFormBody(options: {
  csrf: string;
  form: MonitorForm;
  limits: Limits;
  errors?: string[];
}): SafeHtml {
  const { csrf, form, limits, errors = [] } = options;
  const unitSelect = (name: string, selected: string) =>
    html`<select name="${name}">
      ${(
        [
          ["s", "seconds"],
          ["m", "minutes"],
          ["h", "hours"],
          ["d", "days"],
        ] as const
      ).map(
        ([value, label]) =>
          html`<option
            value="${value}"
            ${value === selected ? html`selected` : ""}
          >
            ${label}
          </option>`,
      )}
    </select>`;
  return html`<p><a href="/">← Dashboard</a></p>
    <h1>New Monitor</h1>
    ${errors.map((e) => html`<p class="error">${e}</p>`)}
    <form method="post" action="/monitors">
      ${csrfField(csrf)}
      <label
        >Name
        <input
          type="text"
          name="name"
          value="${form.name}"
          maxlength="${MAX_NAME_LENGTH}"
          required
      /></label>
      <label
        >Interval (${formatDuration(limits.minIntervalSec)} to
        ${formatDuration(limits.maxIntervalSec)})
        <input
          type="number"
          name="interval"
          value="${form.interval}"
          min="1"
          required
        />
        ${unitSelect("intervalUnit", form.intervalUnit)}</label
      >
      <label
        >Grace period (up to ${formatDuration(limits.maxGraceSec)}; leave empty
        for half the Interval)
        <input type="number" name="grace" value="${form.grace}" min="0" />
        ${unitSelect("graceUnit", form.graceUnit)}</label
      >
      <label
        >Notes (optional)
        <textarea name="notes" rows="3" maxlength="${MAX_NOTES_LENGTH}">
${form.notes}</textarea>
      </label>
      <button type="submit">Create Monitor</button>
    </form>`;
}

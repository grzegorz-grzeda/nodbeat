import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ObjectId, type Db } from "mongodb";
import { requireUser, type Auth } from "./auth.js";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";
import { parseObjectId } from "./ids.js";
import {
  formatDueTime,
  formatDuration,
  formatDurationOrEmpty,
} from "./format.js";
import { setFlash } from "./flash.js";
import { listHeartbeatsSince, type HeartbeatDoc } from "./heartbeats.js";
import { listIncidents, type IncidentDoc } from "./incidents.js";
import {
  heartbeatRetentionText,
  heartbeatsTable,
  heartbeatWindowStart,
  incidentsTable,
  MONITOR_PAGE_LOG_ROWS,
} from "./log-tables.js";
import { copyButton, csrfField, html, type SafeHtml } from "./html.js";
import { KeyedLock } from "./keyed-lock.js";
import { stateBadge } from "./layout.js";
import {
  MONITOR_FORM_SCRIPT,
  monitorFormBody,
  readForm,
  schedulePreview,
  validate,
} from "./monitor-form.js";
import {
  defaultGraceSec,
  limitsFor,
  MAX_HEARTBEAT_MESSAGE_LENGTH,
  type Limits,
} from "./limits.js";
import {
  nextDueAt,
  periodSec,
  type DueFields,
  type MonitorPeriod,
  type MonitorState,
  type MonitorStateFields,
  type MonitorTiming,
} from "./monitor-state.js";
import { startPeriod } from "./state-periods.js";
import { listAlertChannels } from "./alert-channels.js";
import {
  channelsOfMonitor,
  choiceOf,
  type AlertChannelChoice,
} from "./monitor-alert-channels.js";

export type MonitorDoc = MonitorStateFields &
  AlertChannelChoice &
  MonitorTiming & {
    _id: ObjectId;
    ownerId: ObjectId;
    name: string;
    notes: string;
    /** Secret part of the Heartbeat URL. */
    token: string;
    alertsEnabled: boolean;
    createdAt: Date;
  };

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

/** How many Monitors the whole instance has in each Monitor state (the Admin page). */
export async function countMonitorsByState(
  db: Db,
): Promise<Record<MonitorState, number>> {
  const counts: Record<MonitorState, number> = {
    new: 0,
    up: 0,
    down: 0,
    paused: 0,
  };
  const groups = await monitors(db)
    .aggregate<{
      _id: MonitorState;
      count: number;
    }>([{ $group: { _id: "$state", count: { $sum: 1 } } }])
    .toArray();
  for (const g of groups) counts[g._id] = g.count;
  return counts;
}

export interface OwnerMonitors {
  monitorIds: ObjectId[];
  /** The newest Heartbeat across the owner's Monitors, or null. */
  lastHeartbeatAt: Date | null;
}

/** Each User's Monitors and their newest Heartbeat, keyed by owner id (the Admin page). Owners without any are absent. */
export async function monitorsByOwner(
  db: Db,
): Promise<Map<string, OwnerMonitors>> {
  const groups = await monitors(db)
    .aggregate<{
      _id: ObjectId;
      monitorIds: ObjectId[];
      lastHeartbeatAt: Date | null;
    }>([
      {
        $group: {
          _id: "$ownerId",
          monitorIds: { $push: "$_id" },
          lastHeartbeatAt: { $max: "$lastHeartbeatAt" },
        },
      },
    ])
    .toArray();
  return new Map(
    groups.map((g) => [
      String(g._id),
      { monitorIds: g.monitorIds, lastHeartbeatAt: g.lastHeartbeatAt ?? null },
    ]),
  );
}

/** Interval groups by upper bound (inclusive); anything longer falls in the last group. */
const INTERVAL_GROUPS: Array<{ label: string; maxSec: number }> = [
  { label: "≤ 1 min", maxSec: 60 },
  { label: "≤ 5 min", maxSec: 5 * 60 },
  { label: "≤ 1 h", maxSec: 60 * 60 },
  { label: "≤ 1 day", maxSec: 24 * 60 * 60 },
  { label: "> 1 day", maxSec: Infinity },
];

/** Schedule Monitors are a group of their own, after the Interval groups. */
const SCHEDULE_GROUP = "Schedule";

export interface MonitorSetup {
  total: number;
  /** Shortest Intervals first, then Schedule Monitors. */
  byInterval: Array<{ label: string; count: number }>;
  customGrace: number;
  withNotes: number;
  alertsOff: number;
  paused: number;
}

/** How the whole instance's Monitors are set up (the Admin page). Notes are only tested for presence, never read. */
export async function summarizeMonitorSetup(
  db: Db,
  limits: Limits,
  now: Date,
): Promise<MonitorSetup> {
  const rows = await monitors(db)
    .aggregate<
      MonitorPeriod & {
        graceSec: number;
        hasNotes: boolean;
        alertsEnabled: boolean;
        state: MonitorState;
      }
    >([
      {
        $project: {
          _id: 0,
          intervalSec: 1,
          schedule: 1,
          graceSec: 1,
          hasNotes: { $gt: [{ $strLenCP: { $ifNull: ["$notes", ""] } }, 0] },
          alertsEnabled: 1,
          state: 1,
        },
      },
    ])
    .toArray();
  const setup: MonitorSetup = {
    total: rows.length,
    byInterval: [...INTERVAL_GROUPS, { label: SCHEDULE_GROUP }].map(
      ({ label }) => ({ label, count: 0 }),
    ),
    customGrace: 0,
    withNotes: 0,
    alertsOff: 0,
    paused: 0,
  };
  for (const m of rows) {
    if (m.schedule) {
      setup.byInterval[INTERVAL_GROUPS.length]!.count++;
    } else {
      const { intervalSec } = m;
      const group = INTERVAL_GROUPS.findIndex((g) => intervalSec <= g.maxSec);
      setup.byInterval[group]!.count++;
    }
    // Half the period is the default Grace period.
    const period = periodSec(m, now) ?? Infinity;
    if (m.graceSec !== defaultGraceSec(period, limits)) {
      setup.customGrace++;
    }
    if (m.hasNotes) setup.withNotes++;
    if (!m.alertsEnabled) setup.alertsOff++;
    if (m.state === "paused") setup.paused++;
  }
  return setup;
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

/** When a Monitor's next Heartbeat is expected by, as nextDueAt() decides; null and empty for Paused and Down. */
export function nextExpected(
  monitor: DueFields,
  startedAt: Date,
  now: Date,
  timeZone: string,
): { at: Date | null; text: string } {
  const at = nextDueAt(monitor, startedAt);
  return { at, text: at ? formatDueTime(at, now, timeZone) : "" };
}

export function sendMonitorNotFound(reply: FastifyReply): FastifyReply {
  return reply.errorPage(404, { message: "No such Monitor." });
}

export function registerMonitors(
  app: FastifyInstance,
  deps: {
    db: Db;
    clock: Clock;
    config: Config;
    auth: Auth;
    /** When this nodbeat process started, for nextDueAt()'s startup grace. */
    startedAt: Date;
  },
): void {
  const { db, clock, config, auth, startedAt } = deps;
  // Keyed by owner: it guards the per-User Monitor limit.
  const ownerLock = new KeyedLock();

  const heartbeatUrl = (monitor: MonitorDoc) =>
    `${config.publicBaseUrl}/hb/${monitor.token}`;

  app.get("/monitors/new", { preHandler: requireUser }, async (req, reply) =>
    reply.page({
      title: "New Monitor",
      scripts: [MONITOR_FORM_SCRIPT],
      body: monitorFormBody({
        csrf: auth.csrfToken(req, reply),
        form: readForm({}, req.user!.timeZone),
        limits: limitsFor(req.user!),
        channels: await listAlertChannels(db, req.user!._id),
        now: clock.now(),
      }),
    }),
  );

  // The form's Schedule preview as the User types (`assets/monitor-form.js`).
  app.get<{ Querystring: { cron?: unknown; timeZone?: unknown } }>(
    "/monitors/schedule-preview",
    { preHandler: requireUser },
    async (req, reply) => {
      const { cron, timeZone } = req.query;
      const preview = schedulePreview(
        typeof cron === "string" ? cron : "",
        typeof timeZone === "string" ? timeZone : req.user!.timeZone,
        limitsFor(req.user!),
        clock.now(),
      );
      return reply.header("cache-control", "no-store").send(preview);
    },
  );

  app.post("/monitors", { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const limits = limitsFor(user);
    const form = readForm(req.body, user.timeZone);
    const channels = await listAlertChannels(db, user._id);
    const result = validate(form, limits, channels, clock.now());
    const errors = "errors" in result ? result.errors : [];
    // Count and insert under the owner's lock, so parallel requests can't all pass the limit check.
    const monitor = await ownerLock.run(String(user._id), async () => {
      if (
        errors.length === 0 &&
        (await monitors(db).countDocuments({ ownerId: user._id })) >=
          limits.maxMonitors
      ) {
        errors.push(`You can have at most ${limits.maxMonitors} Monitors.`);
      }
      if (errors.length > 0 || !("settings" in result)) return null;
      const doc: MonitorDoc = {
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
        runStartedAt: null,
        lastRunDurationSec: null,
        createdAt: clock.now(),
      };
      await monitors(db).insertOne(doc);
      return doc;
    });
    if (!monitor) {
      return reply.code(400).page({
        title: "New Monitor",
        scripts: [MONITOR_FORM_SCRIPT],
        body: monitorFormBody({
          csrf: auth.csrfToken(req, reply),
          form,
          limits,
          channels,
          now: clock.now(),
          errors,
        }),
      });
    }

    await startPeriod(db, "new", monitor, monitor.createdAt);
    setFlash(reply, "Monitor created.");
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
      // One extra row tells whether there is more than fits, i.e. whether to link the full log.
      const [incidentList, heartbeatList, ownerChannels] = await Promise.all([
        listIncidents(db, monitor._id, MONITOR_PAGE_LOG_ROWS + 1),
        listHeartbeatsSince(
          db,
          monitor._id,
          heartbeatWindowStart(now),
          MONITOR_PAGE_LOG_ROWS + 1,
        ),
        listAlertChannels(db, monitor.ownerId),
      ]);
      const alerted = channelsOfMonitor(monitor, ownerChannels);
      const timeZone = req.user!.timeZone;
      const csrf = auth.csrfToken(req, reply);
      const curlGet = `curl -fsS -m 10 --retry 3 ${url}`;
      const curlPost = `curl -fsS -m 10 --retry 3 --data-raw "battery 3.7V" ${url}`;
      const lastRun = formatDurationOrEmpty(monitor.lastRunDurationSec);
      const due = nextExpected(monitor, startedAt, now, timeZone).text;
      // Start signal, then the job; success or Fail signal ends the Run.
      const cronRun = `curl -fsS -m 10 ${url}/start; /path/to/job.sh && curl -fsS -m 10 ${url} || curl -fsS -m 10 ${url}/fail`;
      // The Schedule's own expression, so the crontab line matches it; its time zone has to match the server's too.
      const cronTimes = monitor.schedule?.cron ?? "*/5 * * * *";
      const cronZone = monitor.schedule
        ? `\n# Times in ${monitor.schedule.timeZone}: the server's time zone (or CRON_TZ) must match`
        : "";
      return reply.page({
        title: monitor.name,
        // Enhances the copy buttons; without JS they stay hidden and the text is still selectable.
        scripts: ["copy.js"],
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
            ${
              alerted.length === 0 &&
              html`<p class="warning">
                Alerts go nowhere: this Monitor has no Alert channels.
              </p>`
            }
            <ul class="plain">
              <li>
                Alert channels:
                ${
                  choiceOf(monitor) === "all"
                    ? "All"
                    : alerted.length === 0
                      ? "none"
                      : alerted.map((c) => c.name).join(", ")
                }
              </li>
              ${
                monitor.schedule
                  ? html`<li>
                      Schedule: <code>${monitor.schedule.cron}</code>
                      (${monitor.schedule.timeZone})
                    </li>`
                  : html`<li>
                      Interval: ${formatDuration(monitor.intervalSec)}
                    </li>`
              }
              <li>Grace period: ${formatDuration(monitor.graceSec)}</li>
              ${
                monitor.maxRunTimeSec != null &&
                html`<li>
                  Max run time: ${formatDuration(monitor.maxRunTimeSec)}
                </li>`
              }
              ${lastRun && html`<li>Last Run duration: ${lastRun}</li>`}
              ${due && html`<li>Next expected by: ${due}</li>`}
            </ul>
            ${monitor.notes ? html`<p class="notes">${monitor.notes}</p>` : ""}
          </div>
          <div class="monitor-columns">
            <section class="monitor-wiring">
              <h2>Heartbeat URL</h2>
              <p>
                Anyone who knows this URL can send Heartbeats for this Monitor.
                Keep it secret.
              </p>
              <div class="copy-row">
                <input
                  type="text"
                  id="hb-url"
                  readonly
                  value="${url}"
                  aria-label="Heartbeat URL"
                />
                ${copyButton("hb-url")}
              </div>
              <p class="actions">
                <a
                  href="/monitors/${String(monitor._id)}/regenerate-url"
                  class="button secondary"
                  >Regenerate URL</a
                >
                <small>The current URL stops working.</small>
              </p>
              <h2>Examples</h2>
              <p>
                Send a GET or POST. An optional message (up to
                ${MAX_HEARTBEAT_MESSAGE_LENGTH} characters) goes in the
                <code>msg</code> query parameter or the request body. Full
                reference: <a href="/docs">API docs</a>.
              </p>
              <h3>curl GET</h3>
              <div class="code-block">
                <pre><code id="curl-get">${curlGet}</code></pre>
                ${copyButton("curl-get")}
              </div>
              <h3>curl POST with a message</h3>
              <div class="code-block">
                <pre><code id="curl-post">${curlPost}</code></pre>
                ${copyButton("curl-post")}
              </div>
              <h3>cron</h3>
              <pre><code># crontab -e: run the job, then send a Heartbeat if it succeeded${cronZone}
${cronTimes} /path/to/job.sh &amp;&amp; curl -fsS -m 10 --retry 3 ${url} &gt; /dev/null</code></pre>
              <h3>cron with Start and Fail signals</h3>
              <pre><code># Times the job and reports a failure at once
${cronTimes} ${cronRun}</code></pre>
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
}</code></pre>
            </section>
            <section class="monitor-logs">
              ${incidentsSection(monitor, incidentList, now, timeZone)}
              ${heartbeatsSection(monitor, heartbeatList, timeZone)}
            </section>
          </div>`,
      });
    },
  );
}

/** Edit and Delete links and the Pause/Unpause button. */
function actionsSection(monitor: MonitorDoc, csrf: string): SafeHtml {
  const base = `/monitors/${String(monitor._id)}`;
  const paused = monitor.state === "paused";
  return html`<div class="actions">
    <a href="${base}/edit" class="button secondary">Edit</a>
    <form method="post" action="${base}/${paused ? "unpause" : "pause"}">
      ${csrfField(csrf)}
      <button type="submit" class="secondary">
        ${paused ? "Unpause" : "Pause"}
      </button>
    </form>
    <a href="${base}/delete" class="button danger">Delete</a>
  </div>`;
}

/** "See all" under a log on the Monitor page when it holds more rows than the page shows. */
function seeAll(href: string, label: string, more: boolean): SafeHtml {
  return more ? html`<p><a href="${href}">${label} →</a></p>` : html``;
}

function incidentsSection(
  monitor: MonitorDoc,
  list: IncidentDoc[],
  now: Date,
  timeZone: string,
): SafeHtml {
  if (list.length === 0) {
    return html`<h2>Incidents</h2>
      <p>No Incidents yet.</p>`;
  }
  return html`<h2>Incidents</h2>
    ${incidentsTable(list.slice(0, MONITOR_PAGE_LOG_ROWS), now, timeZone)}
    ${seeAll(
      `/monitors/${String(monitor._id)}/incidents`,
      "See all Incidents",
      list.length > MONITOR_PAGE_LOG_ROWS,
    )}`;
}

function heartbeatsSection(
  monitor: MonitorDoc,
  list: HeartbeatDoc[],
  timeZone: string,
): SafeHtml {
  const days = heartbeatRetentionText();
  const heading = html`<h2>Heartbeats (last ${days})</h2>`;
  if (list.length === 0) {
    return html`${heading}
      <p>No Heartbeats in the last ${days}.</p>`;
  }
  return html`${heading}
  ${heartbeatsTable(list.slice(0, MONITOR_PAGE_LOG_ROWS), timeZone)}
  ${seeAll(
    `/monitors/${String(monitor._id)}/heartbeats`,
    "See all Heartbeats",
    list.length > MONITOR_PAGE_LOG_ROWS,
  )}`;
}

import { ObjectId } from "mongodb";
import { monitorsTable, type DashboardMonitor } from "./dashboard-table.js";
import { html, type SafeHtml } from "./html.js";
import type { IncidentDoc } from "./incidents.js";
import { incidentsTable } from "./log-tables.js";

const FEATURES: Array<[string, string]> = [
  [
    "Anything that can make an HTTP request",
    "A cron job, a systemd timer, a Raspberry Pi, an ESP32 with Wi-Fi: a GET or POST to the Heartbeat URL is all it takes.",
  ],
  [
    "Interval or Schedule",
    "Expect a Heartbeat every 5 minutes, or at 02:00 on weekdays in your time zone, plus a Grace period before it counts as Down.",
  ],
  [
    "Start and Fail signals",
    "Mark when a job starts and when it fails: a failure is Down at once, and nodbeat shows how long each Run took.",
  ],
  [
    "Max run time",
    "A job that starts but hangs goes Down when it runs longer than you allow.",
  ],
  [
    "Telegram, Webhooks and ntfy",
    "Alerts when a Monitor goes Down and when it's back, to a Telegram chat or group, your own HTTP endpoint, or an ntfy topic.",
  ],
  [
    "Reminders",
    "While a Monitor stays Down, repeat the Alert every 1, 6 or 24 hours, so it isn't forgotten.",
  ],
  [
    "Last message",
    'Send a short text with each Heartbeat, like "battery 3.7V", and see it on the Dashboard and in the Alert.',
  ],
  [
    "Change Alerts",
    'Get an Alert when a Heartbeat\'s message changes, like "door=open" to "door=closed".',
  ],
  [
    "Uptime and Incidents",
    "7-day Uptime per Monitor and a history of every Incident, with Paused time left out.",
  ],
  ["Pause", "Pause a Monitor during maintenance so it doesn't alert."],
];

/** Demo data for the Dashboard preview, in the shape the real Dashboard renders. */
const DEMO_MONITORS: DashboardMonitor[] = [
  demo({
    name: "Nightly database backup",
    state: "up",
    lastHeartbeatText: "6 h ago",
    lastRunDurationText: "3 min 12 s",
    nextExpectedText: "02:00",
    uptime7dText: "100%",
  }),
  demo({
    name: "Greenhouse sensor",
    state: "up",
    lastHeartbeatText: "40 s ago",
    lastMessage: "21.4 °C, battery 3.7V",
    nextExpectedText: "14:06",
    uptime7dText: "99.8%",
  }),
  demo({
    name: "Invoice export",
    state: "down",
    lastHeartbeatText: "12 min ago",
    lastMessage: "SFTP: connection refused",
    lastRunDurationText: "4 s",
    uptime7dText: "97.1%",
  }),
  demo({
    name: "Home server",
    state: "paused",
    lastHeartbeatText: "2 days ago",
    uptime7dText: "99.9%",
  }),
];

function demo(
  m: Pick<
    DashboardMonitor,
    "name" | "state" | "lastHeartbeatText" | "uptime7dText"
  > &
    Partial<DashboardMonitor>,
): DashboardMonitor {
  return {
    id: "demo",
    stateText: "",
    lastHeartbeatAt: null,
    lastHeartbeatTitle: "",
    lastMessage: null,
    lastRunDurationSec: null,
    lastRunDurationText: "",
    nextExpectedAt: null,
    nextExpectedText: "",
    uptime7d: null,
    alertsGoNowhere: false,
    ...m,
  };
}

const HOUR_MS = 60 * 60 * 1000;
const DEMO_NOW = new Date("2026-03-12T13:05:00Z");
const ago = (hours: number) => new Date(DEMO_NOW.getTime() - hours * HOUR_MS);

/** Demo Incidents for the Monitor preview: one ongoing, two closed. */
const DEMO_INCIDENTS: IncidentDoc[] = [
  demoIncident(ago(0.2), null, 1),
  demoIncident(ago(51), ago(50.25), 0),
  demoIncident(ago(170), ago(168), 2),
];

function demoIncident(
  startedAt: Date,
  endedAt: Date | null,
  remindersSent: number,
): IncidentDoc {
  return {
    _id: new ObjectId(),
    monitorId: new ObjectId(),
    ownerId: new ObjectId(),
    startedAt,
    endedAt,
    endReason: endedAt ? "heartbeat" : null,
    remindersSent,
  };
}

/**
 * A picture of the app made of the app's own markup and styles: it follows the theme and never goes stale like a
 * screenshot. `inert` keeps its links and rows out of the tab order and the accessibility tree; the caption says
 * what it shows.
 */
function preview(caption: string, content: SafeHtml): SafeHtml {
  return html`<figure class="preview">
    <div class="preview-frame" inert>${content}</div>
    <figcaption>${caption}</figcaption>
  </figure>`;
}

function telegramAlerts(): SafeHtml {
  return html`<div class="chat">
    <div class="chat-head">nodbeat bot</div>
    <p class="chat-bubble">
      🔴 <b>Invoice export</b> reported a failure<br />
      Since 2026-03-12 13:53:00 (Europe/Warsaw)<br />
      Message: SFTP: connection refused<br />
      <a href="#">Open Monitor</a>
    </p>
    <p class="chat-bubble">
      🟢 <b>Greenhouse sensor</b> is Up again<br />
      At 2026-03-12 09:41:07 (Europe/Warsaw), after 45 min Down<br />
      <a href="#">Open Monitor</a>
    </p>
  </div>`;
}

/** Copy-paste examples for common clients, with the instance's own Heartbeat URL. */
function examples(url: string): Array<[string, string, SafeHtml]> {
  return [
    [
      "cron",
      "Ping after a nightly job, only when it succeeded.",
      html`<pre><code>0 2 * * * /usr/local/bin/backup.sh &amp;&amp; curl -fsS -m 10 --retry 3 ${url} &gt; /dev/null</code></pre>`,
    ],
    [
      "Shell script with Start and Fail signals",
      "nodbeat times the Run, and a failure is Down at once with its message.",
      html`<pre><code>curl -fsS -m 10 ${url}/start
if out=$(./export-invoices.sh 2&gt;&amp;1); then
  curl -fsS -m 10 ${url}
else
  curl -fsS -m 10 --data-raw "$(echo "$out" | tail -c 200)" ${url}/fail
fi</code></pre>`,
    ],
    [
      "systemd",
      "Add to the service a timer runs, so every finished run is a Heartbeat.",
      html`<pre><code>[Service]
ExecStart=/usr/local/bin/sync.sh
ExecStartPost=/usr/bin/curl -fsS -m 10 --retry 3 ${url}</code></pre>`,
    ],
    [
      "ESP32 / Arduino",
      "Report a reading with every Heartbeat; it shows as the Last message.",
      html`<pre><code>HTTPClient http;
http.begin("${url}");
http.POST("21.4 C, battery " + String(readBattery(), 2) + "V");
http.end();</code></pre>`,
    ],
  ];
}

/** The page a visitor without a session sees at `/`. `inviteForm` is "Request an Invite", when it's on. */
export function landingBody(
  publicBaseUrl: string,
  inviteForm?: SafeHtml,
): SafeHtml {
  const exampleUrl = `${publicBaseUrl}/hb/<token>`;
  return html`<section class="hero">
      <h1>A heartbeat for every service and device</h1>
      <p class="lead">
        nodbeat watches the jobs, servers and devices that should check in
        regularly, and alerts you on Telegram, a Webhook or ntfy when one goes
        silent or fails.
      </p>
      <p class="hero-actions">
        ${
          inviteForm
            ? html`<a href="#request-invite" class="button"
                  >Request an Invite</a
                >
                <a href="/login">Log in</a>`
            : html`<a href="/login" class="button">Log in</a>`
        }
      </p>
      ${!inviteForm && html`<p>nodbeat is invite-only for now.</p>`}
    </section>
    <section aria-labelledby="how">
      <h2 id="how">How it works</h2>
      <ol class="steps">
        <li class="card">
          <h3>Create a Monitor</h3>
          <p>Give it a name and an Interval or a Schedule.</p>
        </li>
        <li class="card">
          <h3>Send Heartbeats to its URL</h3>
          <pre><code>curl -fsS -m 10 --retry 3 ${exampleUrl}</code></pre>
        </li>
        <li class="card">
          <h3>Get an Alert</h3>
          <p>When it goes silent or fails, and again when it's back.</p>
        </li>
      </ol>
    </section>
    <section aria-labelledby="look">
      <h2 id="look">What it looks like</h2>
      ${preview(
        "The Dashboard: every Monitor's state, last Heartbeat and message, Run time and 7-day Uptime, updated live.",
        html`<div class="table-wrap">${monitorsTable(DEMO_MONITORS)}</div>`,
      )}
      <div class="preview-pair">
        ${preview(
          "A Monitor's Incidents: when it went Down, for how long, and how many Reminders went out.",
          incidentsTable(DEMO_INCIDENTS, DEMO_NOW, "Europe/Warsaw"),
        )}
        ${preview(
          "Alerts in Telegram: Down with the job's own message, and Up again when it's back.",
          telegramAlerts(),
        )}
      </div>
    </section>
    <section aria-labelledby="examples">
      <h2 id="examples">Examples</h2>
      <div class="examples">
        ${examples(exampleUrl).map(
          ([title, text, code]) =>
            html`<div class="card">
              <h3>${title}</h3>
              <p>${text}</p>
              ${code}
            </div>`,
        )}
      </div>
      <p>
        More in the <a href="/docs">API docs</a>: messages in JSON or form
        bodies, and the Dashboard as JSON.
      </p>
    </section>
    <section aria-labelledby="features">
      <h2 id="features">Features</h2>
      <ul class="features">
        ${FEATURES.map(
          ([title, text]) => html`<li><strong>${title}</strong> ${text}</li>`,
        )}
      </ul>
    </section>
    ${inviteForm}`;
}

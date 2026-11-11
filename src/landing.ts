import { html, type SafeHtml } from "./html.js";

const FEATURES: Array<[string, string]> = [
  [
    "Any device that can make an HTTP request",
    "A cron job, a Raspberry Pi, an Arduino with Wi-Fi: a GET or POST to the Heartbeat URL is all it takes.",
  ],
  [
    "Interval + Grace period",
    "Each Monitor expects a Heartbeat every Interval and waits a Grace period before it goes Down.",
  ],
  [
    "Telegram Alerts",
    "Down and back Up, sent to your own chat or a group you link.",
  ],
  [
    "Last message",
    'Send a short text with each Heartbeat, like "battery 3.7V", and see it on the Dashboard.',
  ],
  [
    "Uptime and Incidents",
    "7-day Uptime per Monitor and an Incident history of every time it went silent.",
  ],
  ["Pause", "Pause a Monitor during maintenance so it doesn't alert."],
];

/** The page a visitor without a session sees at `/`. */
export function landingBody(publicBaseUrl: string): SafeHtml {
  const exampleUrl = `${publicBaseUrl}/hb/<token>`;
  return html`<section class="hero">
      <h1>A heartbeat for every service and device</h1>
      <p class="lead">
        nodbeat watches the things that should check in regularly and tells you
        on Telegram when one goes silent.
      </p>
      <a href="/login" class="button">Log in</a>
      <p>nodbeat is invite-only for now.</p>
    </section>
    <section aria-labelledby="how">
      <h2 id="how">How it works</h2>
      <ol class="steps">
        <li class="card">
          <h3>Create a Monitor</h3>
          <p>Give it a name, an Interval and a Grace period.</p>
        </li>
        <li class="card">
          <h3>Send Heartbeats to its URL</h3>
          <pre><code>curl -fsS -m 10 --retry 3 ${exampleUrl}</code></pre>
        </li>
        <li class="card">
          <h3>Get a Telegram Alert</h3>
          <p>When it goes silent, and again when it's back.</p>
        </li>
      </ol>
    </section>
    <section aria-labelledby="features">
      <h2 id="features">Features</h2>
      <ul class="features">
        ${FEATURES.map(
          ([title, text]) => html`<li><strong>${title}</strong> ${text}</li>`,
        )}
      </ul>
    </section>`;
}

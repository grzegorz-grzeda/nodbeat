import { formatDateTime, formatDuration } from "./format.js";
import { html, type SafeHtml } from "./html.js";
import type { Limits } from "./limits.js";
import { PLAN_LABELS, type PlanName } from "./plans.js";
import type { UserDoc } from "./users.js";

/** Settings' Plan section: the User's Plan, its limits and their usage ("7 of 10 Monitors"). */
export function planSection(options: {
  plan: PlanName;
  user: Pick<UserDoc, "plan" | "timeZone">;
  limits: Limits;
  usage: { monitors: number; alertChannels: number };
}): SafeHtml {
  const { plan, user, limits, usage } = options;
  const until = user.plan?.proUntil;
  const yesNo = (on: boolean) => (on ? "yes" : "needs Pro");
  return html`<h2>Plan</h2>
    <p class="plan">
      <strong>${PLAN_LABELS[plan]}</strong>
      ${
        plan === "pro" && until
          ? html`until ${formatDateTime(until, user.timeZone).slice(0, 10)}`
          : ""
      }
    </p>
    <ul class="plain plan-limits">
      <li>${usage.monitors} of ${limits.maxMonitors} Monitors</li>
      <li>
        ${usage.alertChannels} of ${limits.maxAlertChannels} Alert channels
      </li>
      <li>Shortest Interval: ${formatDuration(limits.minIntervalSec)}</li>
      <li>Webhooks: ${yesNo(limits.features.webhooks)}</li>
      <li>Reminders: ${yesNo(limits.features.reminders)}</li>
      <li>Depends on: ${yesNo(limits.features.parents)}</li>
      <li>
        Kept per Monitor: ${limits.maxHeartbeatsPerMonitor} Heartbeats (up to
        ${formatDuration(limits.heartbeatRetentionSec)}),
        ${limits.maxIncidentsPerMonitor} Incidents
      </li>
    </ul>`;
}

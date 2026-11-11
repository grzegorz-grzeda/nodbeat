import { formatDateTime, formatDuration } from "./format.js";
import type { HeartbeatDoc, SignalKind } from "./heartbeats.js";
import { html, type SafeHtml } from "./html.js";
import type { IncidentDoc } from "./incidents.js";
import { instanceLimits } from "./limits.js";

/** Rows of each log shown on the Monitor page; the rest is on the log pages. */
export const MONITOR_PAGE_LOG_ROWS = 20;

/** The oldest Heartbeat still kept; older ones are gone (TTL index). */
export function heartbeatWindowStart(now: Date): Date {
  return new Date(
    now.getTime() - instanceLimits().heartbeatRetentionSec * 1000,
  );
}

export function heartbeatRetentionText(): string {
  return formatDuration(instanceLimits().heartbeatRetentionSec);
}

export function incidentsTable(
  list: IncidentDoc[],
  now: Date,
  timeZone: string,
): SafeHtml {
  return html`<div class="table-wrap">
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
                  ((i.endedAt ?? now).getTime() - i.startedAt.getTime()) / 1000,
                )}
              </td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

const SIGNAL_LABELS: Record<SignalKind, string> = {
  success: "✓",
  fail: "Fail",
};

export function heartbeatsTable(
  list: HeartbeatDoc[],
  timeZone: string,
): SafeHtml {
  return html`<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Received</th>
          <th>Signal</th>
          <th>Message</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(
          (h) =>
            html`<tr>
              <td>${formatDateTime(h.receivedAt, timeZone)}</td>
              <td>${SIGNAL_LABELS[h.kind ?? "success"]}</td>
              <td>${h.message ?? ""}</td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

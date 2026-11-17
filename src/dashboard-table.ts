import { html, type SafeHtml } from "./html.js";
import { stateBadge } from "./layout.js";
import type { MonitorState } from "./monitor-state.js";

/** One Monitor as the Dashboard JSON reports it. The `*Text` fields are ready to display. */
export interface DashboardMonitor {
  id: string;
  name: string;
  state: MonitorState;
  stateText: string;
  lastHeartbeatAt: string | null;
  /** "2 min ago" or "never". */
  lastHeartbeatText: string;
  /** The last Heartbeat's time in the User's time zone; empty if never. */
  lastHeartbeatTitle: string;
  lastMessage: string | null;
  /** The last finished Run's duration in seconds; null if none. */
  lastRunDurationSec: number | null;
  /** "42 s", or empty if no Run has ended. */
  lastRunDurationText: string;
  /** When the next Heartbeat is due, as the Down checker decides; null for Paused and Down. */
  nextExpectedAt: string | null;
  /** "14:05" in the User's time zone (with the date if not today); empty for Paused and Down. */
  nextExpectedText: string;
  /** 0..1, null when the Monitor was neither Up nor Down in the last 7 days. */
  uptime7d: number | null;
  uptime7dText: string;
  /** The Monitor has no Alert channels: its Alerts go nowhere. */
  alertsGoNowhere: boolean;
}

/** `data-label` heads each cell when the table turns into cards on a phone. */
function row(m: DashboardMonitor): SafeHtml {
  return html`<tr>
    <td class="cell-name">
      <a href="/monitors/${m.id}">${m.name}</a>
      ${m.alertsGoNowhere && html`<small class="warning">Alerts go nowhere</small>`}
    </td>
    <td data-label="State">${stateBadge(m.state)}</td>
    <td data-label="Last Heartbeat" title="${m.lastHeartbeatTitle}">
      ${m.lastHeartbeatText}
    </td>
    <td data-label="Last message">${m.lastMessage ?? ""}</td>
    <td data-label="Last Run">${m.lastRunDurationText}</td>
    <td data-label="Next expected by">${m.nextExpectedText}</td>
    <td data-label="7-day Uptime">${m.uptime7dText}</td>
  </tr>`;
}

/** The Dashboard's table; `tbodyId` names the body `dashboard.js` rebuilds. Also the landing page's preview. */
export function monitorsTable(
  list: DashboardMonitor[],
  tbodyId?: string,
): SafeHtml {
  return html`<table class="cards">
    <thead>
      <tr>
        <th>Monitor</th>
        <th>State</th>
        <th>Last Heartbeat</th>
        <th>Last message</th>
        <th>Last Run</th>
        <th>Next expected by</th>
        <th>7-day Uptime</th>
      </tr>
    </thead>
    <tbody ${tbodyId && html`id="${tbodyId}"`}>
      ${list.map(row)}
    </tbody>
  </table>`;
}

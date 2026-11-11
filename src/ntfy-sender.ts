import type { NtfyChannelDoc } from "./alert-channels.js";
import { ALERT_KINDS, type AlertSender } from "./alerts.js";
import {
  HTTP_CHANNEL_TIMEOUT_MS,
  postAlert,
  type OutboundHttp,
} from "./outbound-http.js";

/** A header value as ntfy reads it: as is when ASCII, else an RFC 2047 encoded-word. */
const headerValue = (value: string) =>
  /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;

/**
 * Sends Alerts to ntfy topics: a POST of the plain-text message with title, priority, tags and click link in headers,
 * authorized with the topic's token when it has one. Outcomes as for every HTTP channel (`postAlert`).
 */
export function createNtfySender(
  deps: OutboundHttp,
): AlertSender<NtfyChannelDoc> {
  return async (channel, alert, attempt) => {
    // An Alert from before ntfy topics existed was never addressed to one.
    if (!alert.details) return;
    const { title, summary: body } = alert.details;
    const headers: Record<string, string> = {
      "content-type": "text/plain; charset=utf-8",
      "user-agent": "nodbeat",
      title: headerValue(title),
      priority: ALERT_KINDS[alert.kind].ntfyPriority,
      tags: ALERT_KINDS[alert.kind].ntfyTag,
      click: alert.details.monitorUrl,
    };
    if (channel.token) headers.authorization = `Bearer ${channel.token}`;
    await postAlert(
      deps,
      String(channel._id),
      { url: channel.url, headers, body, timeoutMs: HTTP_CHANNEL_TIMEOUT_MS },
      attempt,
    );
  };
}

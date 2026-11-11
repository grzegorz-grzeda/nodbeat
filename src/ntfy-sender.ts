import type { NtfyChannelDoc } from "./alert-channels.js";
import type { AlertDoc, AlertSender } from "./alerts.js";
import {
  postAlert,
  type HostResolver,
  type HttpClient,
} from "./outbound-http.js";

/** How long an ntfy server has to answer. */
export const NTFY_TIMEOUT_MS = 5000;

/** ntfy priorities: a Down Alert is urgent, an Up Alert shouldn't wake the User. */
const PRIORITY = { down: "5", up: "2" } as const;
/** ntfy tags shown as emoji, in place of the Telegram text's leading one. */
const TAGS = { down: "red_circle", up: "green_circle" } as const;

const unescapeTelegramHtml = (text: string) =>
  text
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

/**
 * The Alert's Telegram HTML as an ntfy notification: the first line (Monitor name and state) is the title, the rest
 * the plain-text message. The "Open Monitor" link line is left out: the notification's click opens the Monitor.
 */
export function ntfyMessage(alert: AlertDoc): { title: string; body: string } {
  const lines = alert.text
    .split("\n")
    .filter((line) => !/^<a [^>]*>[^<]*<\/a>$/.test(line))
    .map(unescapeTelegramHtml);
  const title = (lines[0] ?? "")
    .replace(/^\p{Extended_Pictographic}️?\s*/u, "")
    .trim();
  return { title, body: lines.slice(1).join("\n") };
}

/** A header value as ntfy reads it: as is when ASCII, else an RFC 2047 encoded-word. */
const headerValue = (value: string) =>
  /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;

/**
 * Sends Alerts to ntfy topics: a POST of the plain-text message with title, priority, tags and click link in headers,
 * authorized with the topic's token when it has one. Outcomes as for every HTTP channel (`postAlert`).
 */
export function createNtfySender(deps: {
  http: HttpClient;
  resolveHost: HostResolver;
}): AlertSender<NtfyChannelDoc> {
  return async (channel, alert, attempt) => {
    // An Alert from before ntfy topics existed was never addressed to one.
    if (!alert.details) return;
    const { title, body } = ntfyMessage(alert);
    const headers: Record<string, string> = {
      "content-type": "text/plain; charset=utf-8",
      "user-agent": "nodbeat",
      title: headerValue(title),
      priority: PRIORITY[alert.kind],
      tags: TAGS[alert.kind],
      click: alert.details.monitorUrl,
    };
    if (channel.token) headers.authorization = `Bearer ${channel.token}`;
    await postAlert(
      deps,
      String(channel._id),
      { url: channel.url, headers, body, timeoutMs: NTFY_TIMEOUT_MS },
      attempt,
    );
  };
}

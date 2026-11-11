import { createHmac } from "node:crypto";
import type { WebhookChannelDoc } from "./alert-channels.js";
import type { AlertDoc, AlertSender } from "./alerts.js";
import {
  HTTP_CHANNEL_TIMEOUT_MS,
  postAlert,
  type OutboundHttp,
} from "./outbound-http.js";

/** The JSON body POSTed to a Webhook (documented in `api/openapi.yaml`). */
export function webhookBody(alert: AlertDoc): string | null {
  const { details } = alert;
  if (!details) return null;
  return JSON.stringify({
    monitor: {
      id: String(alert.monitorId),
      name: details.monitorName,
      url: details.monitorUrl,
    },
    kind: alert.kind,
    at: details.at.toISOString(),
    message: details.message,
    incidentId: String(alert.incidentId),
  });
}

/** `sha256=<hex HMAC-SHA256 of the body>`, sent as `X-Nodbeat-Signature`. */
export const webhookSignature = (secret: string, body: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

/**
 * Sends Alerts to Webhooks: a JSON POST, signed when the Webhook has a secret. Outcomes as for every HTTP channel
 * (`postAlert`).
 */
export function createWebhookSender(
  deps: OutboundHttp,
): AlertSender<WebhookChannelDoc> {
  return async (channel, alert, attempt) => {
    const id = String(channel._id);
    const body = webhookBody(alert);
    // An Alert from before Webhooks existed was never addressed to one.
    if (body === null) return;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "nodbeat",
    };
    if (channel.secret) {
      headers["x-nodbeat-signature"] = webhookSignature(channel.secret, body);
    }
    await postAlert(
      deps,
      id,
      { url: channel.url, headers, body, timeoutMs: HTTP_CHANNEL_TIMEOUT_MS },
      attempt,
    );
  };
}

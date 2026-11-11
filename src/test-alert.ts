import { ObjectId, type Db } from "mongodb";
import {
  clearChannelsFailing,
  type AlertChannelDoc,
} from "./alert-channels.js";
import type {
  AlertDoc,
  AlertSender,
  AlertSenders,
  DeliveryAttempt,
} from "./alerts.js";

/** How a test Alert went: delivered, or not with why. */
export type TestAlertResult = { ok: true } | { ok: false; error: string };

/** The test Alert: shaped like a Down Alert, but about no Monitor. */
function testAlert(
  channel: AlertChannelDoc,
  now: Date,
  publicBaseUrl: string,
): AlertDoc {
  return {
    _id: new ObjectId(),
    monitorId: new ObjectId(),
    ownerId: channel.ownerId,
    kind: "down",
    incidentId: new ObjectId(),
    text: "🔔 <b>Test Alert</b> from nodbeat\nAlerts for your Monitors arrive here.",
    options: { parseMode: "HTML" },
    // For HTTP channels: points at Settings, where the test was sent from.
    details: {
      monitorName: "Test Alert",
      monitorUrl: `${publicBaseUrl}/settings`,
      at: now,
      message: "Test Alert from nodbeat: Alerts for your Monitors arrive here.",
    },
    channelIds: [channel._id],
    attempts: 0,
    createdAt: now,
    firstFailedAt: null,
    nextAttemptAt: now,
  };
}

/**
 * Sends a test Alert to the channel at once through the sender of its kind: not through the outbox, no retries.
 * Getting through clears Failing.
 */
export async function testAlertChannel(
  db: Db,
  senders: AlertSenders,
  channel: AlertChannelDoc,
  now: Date,
  publicBaseUrl: string,
): Promise<TestAlertResult> {
  const id = String(channel._id);
  const attempt: DeliveryAttempt = { delivered: new Set(), failed: new Map() };
  const send = senders[channel.kind] as AlertSender<AlertChannelDoc>;
  try {
    await send(channel, testAlert(channel, now, publicBaseUrl), attempt);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  // A Linked chat whose group became a supergroup is delivered to under its new (or merged-into) channel.
  if (attempt.delivered.size > 0) {
    await clearChannelsFailing(db, attempt.delivered);
    return { ok: true };
  }
  const error = attempt.failed.get(id);
  // Neither delivered nor failed: the sender gave up on the channel, e.g. Telegram unlinked a chat that blocked the bot.
  return { ok: false, error: error ?? "the channel can't receive Alerts" };
}

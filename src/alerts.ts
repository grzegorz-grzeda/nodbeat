import { ObjectId, type Db, type PullOperator } from "mongodb";
import {
  clearChannelsFailing,
  listAlertChannels,
  markChannelsFailing,
  type AlertChannelDoc,
  type AlertChannelKind,
  type AlertChannelOf,
} from "./alert-channels.js";
import type { Clock } from "./clock.js";
import { formatDateTime, formatDuration } from "./format.js";
import type { IncidentDoc } from "./incidents.js";
import type { IncidentCause } from "./monitor-state.js";
import { findLinkedChatByChatId, moveLinkedChats } from "./linked-chats.js";
import {
  channelsOfMonitor,
  replaceInMonitors,
  type AlertChannelChoice,
} from "./monitor-alert-channels.js";
import type { SendMessageOptions } from "./telegram.js";
import { DEFAULT_TIME_ZONE, findUserById } from "./users.js";

/** An Alert waiting in the outbox. Removed once every Alert channel it is addressed to has it, or when it is given up on. */
export interface AlertDoc {
  _id: ObjectId;
  monitorId: ObjectId;
  ownerId: ObjectId;
  kind: AlertKind;
  incidentId: ObjectId;
  /** The message in Telegram HTML, formatted when the Alert was enqueued. */
  text: string;
  /** How `text` is sent. Absent on Alerts enqueued before Alerts were Telegram HTML: those are plain text. */
  options?: SendMessageOptions;
  /** The Alert as data, for channels that aren't sent `text` (a Webhook's JSON body). Absent on Alerts enqueued
   * before Webhooks existed: those are addressed to Linked chats only. */
  details?: AlertDetails;
  /** Alert channels that still have to receive it. */
  channelIds: ObjectId[];
  attempts: number;
  createdAt: Date;
  /** Starts the retry window; null until a send fails. */
  firstFailedAt: Date | null;
  nextAttemptAt: Date;
}

/** What an Alert says, kind-agnostic. */
export interface AlertDetails {
  monitorName: string;
  /** The Monitor page. */
  monitorUrl: string;
  /** When the Monitor went Down (Incident start) or came Up (Incident end). */
  at: Date;
  /** A Down Alert's last Heartbeat or Fail signal message; null on Up Alerts or when there's none. */
  message: string | null;
}

/** An outbox entry as stored before Alert channels existed: addressed to Telegram chat ids. */
interface LegacyAlertDoc extends Omit<AlertDoc, "channelIds"> {
  chatIds: number[];
}

export type AlertKind = "down" | "up";

/** The slice of a logger the dispatcher needs (Fastify's logger fits). */
export interface AlertLog {
  warn(obj: object, msg: string): void;
}

/** What one dispatch of an Alert has achieved so far, keyed by Alert channel id. Senders record into it. */
export interface DeliveryAttempt {
  /** Channels that got the Alert in this dispatch: none is sent it twice. */
  readonly delivered: Set<string>;
  /** Channels whose send failed and is retried, with the error. */
  readonly failed: Map<string, string>;
}

/**
 * Sends an Alert to one Alert channel of its kind and records the outcome in `attempt`: `delivered` on success,
 * `failed` for a send worth retrying. Recording neither means the channel is done with (e.g. it was removed).
 */
export type AlertSender<C extends AlertChannelDoc> = (
  channel: C,
  alert: AlertDoc,
  attempt: DeliveryAttempt,
) => Promise<void>;

/** One sender per Alert channel kind; the dispatcher picks it by the channel's `kind`. */
export type AlertSenders = {
  [K in AlertChannelKind]: AlertSender<AlertChannelOf<K>>;
};

/** A failed send is retried for this long after the first failure, then dropped. */
export const ALERT_RETRY_WINDOW_MS = 60 * 60 * 1000;
const FIRST_RETRY_DELAY_MS = 30 * 1000;

const outbox = (db: Db) => db.collection<AlertDoc>("alertOutbox");

export async function ensureAlertIndexes(db: Db): Promise<void> {
  await Promise.all([
    outbox(db).createIndex({ monitorId: 1, createdAt: 1, _id: 1 }),
    outbox(db).createIndex({ incidentId: 1 }),
  ]);
}

/**
 * Readdresses Alerts queued before Alert channels existed from Telegram chat ids to the owner's Linked chats. Run
 * after the Linked chats are migrated; running it again changes nothing.
 */
export async function migrateAlertOutbox(db: Db): Promise<void> {
  const legacy = db.collection<LegacyAlertDoc>("alertOutbox");
  for (const alert of await legacy
    .find({ chatIds: { $exists: true } })
    .toArray()) {
    const channels = await Promise.all(
      alert.chatIds.map((chatId) =>
        findLinkedChatByChatId(db, alert.ownerId, chatId),
      ),
    );
    await db.collection("alertOutbox").updateOne(
      { _id: alert._id },
      {
        $set: { channelIds: channels.flatMap((c) => (c ? [c._id] : [])) },
        $unset: { chatIds: "" },
      },
    );
  }
}

/** The part of a Monitor an Alert is built from and addressed by. */
export interface AlertedMonitor extends AlertChannelChoice {
  _id: ObjectId;
  ownerId: ObjectId;
  name: string;
  /** The last Heartbeat's message; a Down Alert carries it. */
  lastMessage: string | null;
}

/** Puts an Alert about `incident` in the outbox, addressed to the Monitor's Alert channels at this moment; none → nothing. */
export async function enqueueAlert(
  db: Db,
  monitor: AlertedMonitor,
  kind: AlertKind,
  incident: IncidentDoc,
  now: Date,
  publicBaseUrl: string,
): Promise<void> {
  const [owner, ownerChannels] = await Promise.all([
    findUserById(db, monitor.ownerId),
    listAlertChannels(db, monitor.ownerId),
  ]);
  const channels = channelsOfMonitor(monitor, ownerChannels);
  if (channels.length === 0) return;
  const timeZone = owner?.timeZone ?? DEFAULT_TIME_ZONE;
  const details: AlertDetails = {
    monitorName: monitor.name,
    monitorUrl: monitorUrl(publicBaseUrl, monitor),
    at:
      kind === "down"
        ? incident.startedAt
        : (incident.endedAt ?? incident.startedAt),
    message: kind === "down" ? monitor.lastMessage : null,
  };
  await outbox(db).insertOne({
    _id: new ObjectId(),
    monitorId: monitor._id,
    ownerId: monitor.ownerId,
    kind,
    incidentId: incident._id,
    text: alertText(monitor, kind, incident, timeZone, publicBaseUrl),
    // An Up Alert is good news: it shouldn't wake the User.
    options: { parseMode: "HTML", disableNotification: kind === "up" },
    details,
    channelIds: channels.map((c) => c._id),
    attempts: 0,
    createdAt: now,
    firstFailedAt: null,
    nextAttemptAt: now,
  });
}

const monitorUrl = (publicBaseUrl: string, monitor: AlertedMonitor) =>
  `${publicBaseUrl}/monitors/${String(monitor._id)}`;

/** Escapes text from Users or devices for Telegram HTML, in text and in attribute values. */
const escapeTelegramHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** A Down Alert's first line after the name, by why the Incident opened. */
const DOWN_HEADLINES: Record<IncidentCause, (incident: IncidentDoc) => string> =
  {
    missed: () => "is Down",
    failed: () => "reported a failure",
    "run-too-long": ({ maxRunTimeSec }) =>
      maxRunTimeSec !== undefined
        ? `ran longer than ${formatDuration(maxRunTimeSec)}`
        : "ran longer than its Max run time",
  };

/** The Alert in Telegram HTML: bold name, state, when, details, and a link to the Monitor page. */
function alertText(
  monitor: AlertedMonitor,
  kind: AlertKind,
  incident: IncidentDoc,
  timeZone: string,
  publicBaseUrl: string,
): string {
  const at = (date: Date) => `${formatDateTime(date, timeZone)} (${timeZone})`;
  const name = `<b>${escapeTelegramHtml(monitor.name)}</b>`;
  const url = monitorUrl(publicBaseUrl, monitor);
  const link = `<a href="${escapeTelegramHtml(url)}">Open Monitor</a>`;
  if (kind === "down") {
    // Missing on Incidents stored before causes existed: those are missed deadlines.
    const cause = incident.cause ?? "missed";
    const failed = cause === "failed";
    const lines = [
      `🔴 ${name} ${DOWN_HEADLINES[cause](incident)}`,
      `Since ${at(incident.startedAt)}`,
    ];
    if (monitor.lastMessage) {
      // A failure's message is the Fail signal's own.
      const label = failed ? "Message" : "Last message";
      lines.push(`${label}: ${escapeTelegramHtml(monitor.lastMessage)}`);
    }
    return [...lines, link].join("\n");
  }
  const endedAt = incident.endedAt ?? incident.startedAt;
  const duration = formatDuration(
    (endedAt.getTime() - incident.startedAt.getTime()) / 1000,
  );
  return [
    `🟢 ${name} is Up again`,
    `At ${at(endedAt)}, after ${duration} Down`,
    link,
  ].join("\n");
}

/**
 * Follows a group upgraded to a supergroup: its Linked chats move to the new chat id. Where an owner already had the
 * new id linked, the old Linked chat is merged into that one, and its pending Alerts and Monitors' chosen lists are
 * readdressed to it.
 */
export async function migrateChat(
  db: Db,
  fromChatId: number,
  toChatId: number,
): Promise<void> {
  for (const { from, to } of await moveLinkedChats(db, fromChatId, toChatId)) {
    await replaceInMonitors(db, from, to);
    await outbox(db).updateMany({ channelIds: from }, [
      {
        $set: {
          channelIds: {
            $setUnion: [
              {
                $map: {
                  input: "$channelIds",
                  in: { $cond: [{ $eq: ["$$this", from] }, to, "$$this"] },
                },
              },
            ],
          },
        },
      },
    ]);
  }
}

/** A Down Alert not yet delivered when its Incident closes is stale: the Up Alert says it all. */
export async function dropPendingDownAlert(
  db: Db,
  incidentId: ObjectId,
): Promise<void> {
  await outbox(db).deleteMany({ incidentId, kind: "down" });
}

/** Removes all of the Monitor's pending Alerts (when the Monitor is deleted). */
export async function deleteAlertsOf(
  db: Db,
  monitorId: ObjectId,
): Promise<void> {
  await outbox(db).deleteMany({ monitorId });
}

/**
 * Sends due Alerts, each to its Alert channels through the sender of the channel's kind. Per Monitor, Alerts go out
 * strictly in order: one that is still being retried holds back the ones after it. A failed send is retried (to the
 * channels that failed only) with exponential backoff until ALERT_RETRY_WINDOW_MS after the first failure, then the
 * Alert is dropped with a log entry and the channels still failing are marked Failing. A channel that gets an Alert
 * is no longer Failing.
 */
export function createAlertDispatcher(deps: {
  db: Db;
  clock: Clock;
  senders: AlertSenders;
  log: AlertLog;
}): () => Promise<void> {
  const { db, clock, senders, log } = deps;
  let running: Promise<void> | null = null;

  const dispatch = async (): Promise<void> => {
    const now = clock.now();
    const pending = await outbox(db)
      .find({})
      .sort({ monitorId: 1, createdAt: 1, _id: 1 })
      .toArray();
    const byMonitor = new Map<string, AlertDoc[]>();
    for (const alert of pending) {
      const key = String(alert.monitorId);
      const alerts = byMonitor.get(key);
      if (alerts) alerts.push(alert);
      else byMonitor.set(key, [alert]);
    }
    for (const alerts of byMonitor.values()) {
      for (const alert of alerts) {
        if (alert.nextAttemptAt > now) break;
        if (!(await deliver(alert, now))) break;
      }
    }
  };

  const sendTo = (
    channel: AlertChannelDoc,
    alert: AlertDoc,
    attempt: DeliveryAttempt,
  ): Promise<void> =>
    (senders[channel.kind] as AlertSender<AlertChannelDoc>)(
      channel,
      alert,
      attempt,
    );

  /** Sends to the channels still missing the Alert; true once it is done with (delivered or given up on). */
  const deliver = async (loaded: AlertDoc, now: Date): Promise<boolean> => {
    // Re-read: the Alert may have been dropped (its Incident closed, its Monitor deleted) since the outbox was loaded.
    const alert = await outbox(db).findOne({ _id: loaded._id });
    if (!alert) return true;
    // A channel removed since the Alert was enqueued no longer gets it.
    const channels = new Map(
      (await listAlertChannels(db, alert.ownerId)).map((c) => [
        String(c._id),
        c,
      ]),
    );
    const attempt: DeliveryAttempt = {
      delivered: new Set(),
      failed: new Map(),
    };
    for (const id of alert.channelIds) {
      const channel = channels.get(String(id));
      if (channel && !attempt.delivered.has(String(id))) {
        await sendTo(channel, alert, attempt);
      }
    }
    const { failed } = attempt;
    await clearChannelsFailing(db, attempt.delivered);
    const attempts = alert.attempts + 1;
    const firstFailedAt = alert.firstFailedAt ?? now;
    const giveUpAt = firstFailedAt.getTime() + ALERT_RETRY_WINDOW_MS;
    const givingUp = failed.size > 0 && now.getTime() >= giveUpAt;
    if (failed.size === 0 || givingUp) {
      await outbox(db).deleteOne({ _id: alert._id });
      if (givingUp) {
        await markChannelsFailing(db, failed, now);
        log.warn(
          {
            monitorId: String(alert.monitorId),
            kind: alert.kind,
            channelIds: [...failed.keys()],
            errors: [...failed.values()],
            attempts,
          },
          `Alert dropped: sending kept failing for ${ALERT_RETRY_WINDOW_MS / 60_000} min`,
        );
      }
      return true;
    }
    const delay = FIRST_RETRY_DELAY_MS * 2 ** (attempts - 1);
    // Remove only the channels done with, rather than writing `failed` back: a Linked chat merged into another
    // while this dispatch ran (a group upgraded to a supergroup) has had its id replaced, and the old id mustn't
    // come back.
    const done = [
      ...alert.channelIds,
      ...[...attempt.delivered].map((id) => new ObjectId(id)),
    ].filter((id) => !failed.has(String(id)));
    await outbox(db).updateOne(
      { _id: alert._id },
      {
        $pull: { channelIds: { $in: done } } as PullOperator<AlertDoc>,
        $set: {
          attempts,
          firstFailedAt,
          nextAttemptAt: new Date(Math.min(now.getTime() + delay, giveUpAt)),
        },
      },
    );
    return false;
  };

  return () => {
    // One dispatch at a time, so an Alert is never sent twice by overlapping ticks.
    running ??= dispatch().finally(() => {
      running = null;
    });
    return running;
  };
}

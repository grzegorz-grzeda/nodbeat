import {
  ObjectId,
  type Db,
  type PullOperator,
  type UpdateFilter,
} from "mongodb";
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

/** An Alert waiting in the outbox. Removed once every Alert channel it is addressed to has it or was given up on. */
export interface AlertDoc {
  _id: ObjectId;
  monitorId: ObjectId;
  ownerId: ObjectId;
  kind: SentAlertKind;
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
  createdAt: Date;
  /** Retry state of each channel whose send failed, keyed by channel id; a channel not in it is due at once. */
  retries?: Record<string, ChannelRetry>;
}

/** Where retrying one Alert channel's send stands: each channel backs off on its own. */
export interface ChannelRetry {
  attempts: number;
  /** Starts the retry window. */
  firstFailedAt: Date;
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
  /** Monitor name and state in plain text, e.g. "Garden sensor is Down". */
  title: string;
  /** The rest of the Alert in plain text, one line each: when, and the message. */
  summary: string;
}

/** An outbox entry as stored before Alert channels existed: addressed to Telegram chat ids, one retry state for all. */
interface LegacyAlertDoc extends Omit<AlertDoc, "channelIds" | "retries"> {
  chatIds: number[];
  attempts: number;
  firstFailedAt: Date | null;
  nextAttemptAt: Date;
}

/** What a Monitor's Alert says happened. */
export type AlertKind = "down" | "up";
/** Any Alert sent: a Monitor's, or a test Alert (sent from Settings, never queued). */
export type SentAlertKind = AlertKind | "test";

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

/** Sends the Alert to the channel through the sender of the channel's kind. */
export const sendTo = (
  senders: AlertSenders,
  channel: AlertChannelDoc,
  alert: AlertDoc,
  attempt: DeliveryAttempt,
): Promise<void> =>
  // The map pairs each kind with its sender; TypeScript can't correlate `channel.kind` with the lookup.
  (senders[channel.kind] as AlertSender<AlertChannelDoc>)(
    channel,
    alert,
    attempt,
  );

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
 * Readdresses Alerts queued before Alert channels existed from Telegram chat ids to the owner's Linked chats, each
 * channel keeping the Alert's retry state. Run after the Linked chats are migrated; running it again changes nothing.
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
    const channelIds = channels.flatMap((c) => (c ? [c._id] : []));
    const { attempts, firstFailedAt, nextAttemptAt } = alert;
    const retries: Record<string, ChannelRetry> =
      firstFailedAt && attempts > 0
        ? Object.fromEntries(
            channelIds.map((id) => [
              String(id),
              { attempts, firstFailedAt, nextAttemptAt },
            ]),
          )
        : {};
    await db.collection("alertOutbox").updateOne(
      { _id: alert._id },
      {
        $set: { channelIds, retries },
        $unset: {
          chatIds: "",
          attempts: "",
          firstFailedAt: "",
          nextAttemptAt: "",
        },
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
  const url = monitorUrl(publicBaseUrl, monitor);
  const parts = alertParts(monitor, kind, incident, timeZone);
  const details: AlertDetails = {
    monitorName: monitor.name,
    monitorUrl: url,
    at:
      kind === "down"
        ? incident.startedAt
        : (incident.endedAt ?? incident.startedAt),
    message: kind === "down" ? monitor.lastMessage : null,
    title: `${monitor.name} ${parts.state}`,
    summary: parts.lines.join("\n"),
  };
  await outbox(db).insertOne({
    _id: new ObjectId(),
    monitorId: monitor._id,
    ownerId: monitor.ownerId,
    kind,
    incidentId: incident._id,
    text: alertText(monitor, parts, url),
    // An Up Alert is good news: it shouldn't wake the User.
    options: { parseMode: "HTML", disableNotification: kind === "up" },
    details,
    channelIds: channels.map((c) => c._id),
    createdAt: now,
    retries: {},
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

/** An Alert's parts in plain text, rendered as Telegram HTML or as plain text (ntfy). */
interface AlertParts {
  emoji: string;
  /** What happened, after the Monitor name: "is Down", "is Up again", ... */
  state: string;
  /** Lines after the first. */
  lines: string[];
}

function alertParts(
  monitor: AlertedMonitor,
  kind: AlertKind,
  incident: IncidentDoc,
  timeZone: string,
): AlertParts {
  const at = (date: Date) => `${formatDateTime(date, timeZone)} (${timeZone})`;
  if (kind === "down") {
    // Missing on Incidents stored before causes existed: those are missed deadlines.
    const cause = incident.cause ?? "missed";
    const lines = [`Since ${at(incident.startedAt)}`];
    if (monitor.lastMessage) {
      // A failure's message is the Fail signal's own.
      const label = cause === "failed" ? "Message" : "Last message";
      lines.push(`${label}: ${monitor.lastMessage}`);
    }
    return { emoji: "🔴", state: DOWN_HEADLINES[cause](incident), lines };
  }
  const endedAt = incident.endedAt ?? incident.startedAt;
  const duration = formatDuration(
    (endedAt.getTime() - incident.startedAt.getTime()) / 1000,
  );
  return {
    emoji: "🟢",
    state: "is Up again",
    lines: [`At ${at(endedAt)}, after ${duration} Down`],
  };
}

/** The Alert in Telegram HTML: bold name, state, when, details, and a link to the Monitor page. */
function alertText(monitor: AlertedMonitor, parts: AlertParts, url: string) {
  const name = `<b>${escapeTelegramHtml(monitor.name)}</b>`;
  const link = `<a href="${escapeTelegramHtml(url)}">Open Monitor</a>`;
  return [
    `${parts.emoji} ${name} ${parts.state}`,
    ...parts.lines.map(escapeTelegramHtml),
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
 * Sends due Alerts, each to its Alert channels through the sender of the channel's kind. Per Monitor and channel,
 * Alerts go out strictly in order: one still being retried to a channel holds back the ones after it for that channel
 * only. A failed send to a channel is retried with exponential backoff until ALERT_RETRY_WINDOW_MS after its first
 * failure, then given up on for that channel with a log entry, and the channel is marked Failing. A channel that gets
 * an Alert is no longer Failing.
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
    /** Per Monitor, the channels an earlier Alert is still pending for. */
    const held = new Map<string, Set<string>>();
    for (const alert of pending) {
      const key = String(alert.monitorId);
      const blocked = held.get(key) ?? new Set<string>();
      held.set(key, blocked);
      const due: string[] = [];
      for (const id of alert.channelIds.map(String)) {
        const retry = alert.retries?.[id];
        if (blocked.has(id)) continue;
        if (!retry || retry.nextAttemptAt <= now) due.push(id);
        else blocked.add(id);
      }
      if (due.length > 0) {
        for (const id of await deliver(alert._id, due, now)) blocked.add(id);
      }
    }
  };

  /**
   * Sends the Alert to its due channels (ids); returns the ones whose send failed and is retried. A channel sent to
   * here is otherwise done with: delivered, given up on, or gone.
   */
  const deliver = async (
    alertId: ObjectId,
    due: string[],
    now: Date,
  ): Promise<string[]> => {
    // Re-read: the Alert may have been dropped (its Incident closed, its Monitor deleted) since the outbox was loaded.
    const alert = await outbox(db).findOne({ _id: alertId });
    if (!alert) return [];
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
    const addressed = new Set(alert.channelIds.map(String));
    for (const id of due) {
      const channel = channels.get(id);
      if (addressed.has(id) && channel && !attempt.delivered.has(id)) {
        await sendTo(senders, channel, alert, attempt);
      }
    }
    await clearChannelsFailing(db, attempt.delivered);

    const retrying: string[] = [];
    const givenUp = new Map<string, string>();
    const retries: Record<string, ChannelRetry> = {};
    for (const [id, error] of attempt.failed) {
      const previous = alert.retries?.[id];
      const attempts = (previous?.attempts ?? 0) + 1;
      const firstFailedAt = previous?.firstFailedAt ?? now;
      const giveUpAt = firstFailedAt.getTime() + ALERT_RETRY_WINDOW_MS;
      if (now.getTime() >= giveUpAt) {
        givenUp.set(id, error);
        continue;
      }
      const delay = FIRST_RETRY_DELAY_MS * 2 ** (attempts - 1);
      retries[id] = {
        attempts,
        firstFailedAt,
        nextAttemptAt: new Date(Math.min(now.getTime() + delay, giveUpAt)),
      };
      retrying.push(id);
    }
    if (givenUp.size > 0) {
      await markChannelsFailing(db, givenUp, now);
      log.warn(
        {
          monitorId: String(alert.monitorId),
          kind: alert.kind,
          channelIds: [...givenUp.keys()],
          errors: [...givenUp.values()],
          attempts: [...givenUp.keys()].map(
            (id) => (alert.retries?.[id]?.attempts ?? 0) + 1,
          ),
        },
        `Alert dropped: sending kept failing for ${ALERT_RETRY_WINDOW_MS / 60_000} min`,
      );
    }
    // Remove only the channels done with, rather than writing the pending list back: a Linked chat merged into another
    // while this dispatch ran (a group upgraded to a supergroup) has had its id replaced, and the old id mustn't come
    // back.
    const done = [...new Set([...due, ...attempt.delivered])].filter(
      (id) => !(id in retries),
    );
    const update: UpdateFilter<AlertDoc> = {
      $pull: {
        channelIds: { $in: done.map((id) => new ObjectId(id)) },
      } as PullOperator<AlertDoc>,
    };
    if (retrying.length > 0) {
      update.$set = Object.fromEntries(
        Object.entries(retries).map(([id, r]) => [`retries.${id}`, r]),
      );
    }
    if (done.length > 0) {
      update.$unset = Object.fromEntries(
        done.map((id) => [`retries.${id}`, ""]),
      );
    }
    const updated = await outbox(db).findOneAndUpdate(
      { _id: alert._id },
      update,
      { returnDocument: "after" },
    );
    if (updated && updated.channelIds.length === 0) {
      await outbox(db).deleteOne({ _id: alert._id, channelIds: { $size: 0 } });
    }
    return retrying;
  };

  return () => {
    // One dispatch at a time, so an Alert is never sent twice by overlapping ticks.
    running ??= dispatch().finally(() => {
      running = null;
    });
    return running;
  };
}

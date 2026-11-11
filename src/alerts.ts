import { ObjectId, type Db } from "mongodb";
import type { Clock } from "./clock.js";
import { formatDateTime, formatDuration } from "./format.js";
import type { IncidentDoc } from "./incidents.js";
import {
  listLinkedChats,
  moveLinkedChats,
  unlinkChat,
} from "./linked-chats.js";
import {
  TelegramChatMigratedError,
  TelegramForbiddenError,
  type SendMessageOptions,
  type TelegramClient,
} from "./telegram.js";
import { DEFAULT_TIME_ZONE, findUserById } from "./users.js";

/** An Alert waiting in the outbox. Removed once every Linked chat has it, or when it is given up on. */
export interface AlertDoc {
  _id: ObjectId;
  monitorId: ObjectId;
  ownerId: ObjectId;
  kind: AlertKind;
  incidentId: ObjectId;
  /** The message, formatted when the Alert was enqueued. */
  text: string;
  /** How `text` is sent. Absent on Alerts enqueued before Alerts were Telegram HTML: those are plain text. */
  options?: SendMessageOptions;
  /** Linked chats that still have to receive it. */
  chatIds: number[];
  attempts: number;
  createdAt: Date;
  /** Starts the retry window; null until a send fails. */
  firstFailedAt: Date | null;
  nextAttemptAt: Date;
}

export type AlertKind = "down" | "up";

/** The slice of a logger the dispatcher needs (Fastify's logger fits). */
export interface AlertLog {
  warn(obj: object, msg: string): void;
}

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

/** The part of a Monitor an Alert is built from. */
export interface AlertedMonitor {
  _id: ObjectId;
  ownerId: ObjectId;
  name: string;
  /** The last Heartbeat's message; a Down Alert carries it. */
  lastMessage: string | null;
}

/** Puts an Alert about `incident` in the outbox, addressed to the owner's Linked chats at this moment. */
export async function enqueueAlert(
  db: Db,
  monitor: AlertedMonitor,
  kind: AlertKind,
  incident: IncidentDoc,
  now: Date,
  publicBaseUrl: string,
): Promise<void> {
  const [owner, chats] = await Promise.all([
    findUserById(db, monitor.ownerId),
    listLinkedChats(db, monitor.ownerId),
  ]);
  if (chats.length === 0) return;
  const timeZone = owner?.timeZone ?? DEFAULT_TIME_ZONE;
  await outbox(db).insertOne({
    _id: new ObjectId(),
    monitorId: monitor._id,
    ownerId: monitor.ownerId,
    kind,
    incidentId: incident._id,
    text: alertText(monitor, kind, incident, timeZone, publicBaseUrl),
    // An Up Alert is good news: it shouldn't wake the User.
    options: { parseMode: "HTML", disableNotification: kind === "up" },
    chatIds: chats.map((c) => c.chatId),
    attempts: 0,
    createdAt: now,
    firstFailedAt: null,
    nextAttemptAt: now,
  });
}

/** Escapes text from Users or devices for Telegram HTML, in text and in attribute values. */
const escapeTelegramHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

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
  const url = `${publicBaseUrl}/monitors/${String(monitor._id)}`;
  const link = `<a href="${escapeTelegramHtml(url)}">Open Monitor</a>`;
  if (kind === "down") {
    const lines = [`🔴 ${name} is Down`, `Since ${at(incident.startedAt)}`];
    if (monitor.lastMessage) {
      lines.push(`Last message: ${escapeTelegramHtml(monitor.lastMessage)}`);
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

/** Follows a group upgraded to a supergroup: its Linked chats and its pending Alerts move to the new chat id. */
export async function migrateChat(
  db: Db,
  fromChatId: number,
  toChatId: number,
): Promise<void> {
  await moveLinkedChats(db, fromChatId, toChatId);
  await outbox(db).updateMany({ chatIds: fromChatId }, [
    {
      $set: {
        chatIds: {
          $setUnion: [
            {
              $map: {
                input: "$chatIds",
                in: {
                  $cond: [{ $eq: ["$$this", fromChatId] }, toChatId, "$$this"],
                },
              },
            },
          ],
        },
      },
    },
  ]);
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
 * Sends due Alerts. Per Monitor, Alerts go out strictly in order: one that is still being retried holds back
 * the ones after it. A failed send is retried with exponential backoff until ALERT_RETRY_WINDOW_MS after the first
 * failure, then the Alert is dropped with a log entry.
 */
export function createAlertDispatcher(deps: {
  db: Db;
  clock: Clock;
  telegram: TelegramClient;
  log: AlertLog;
}): () => Promise<void> {
  const { db, clock, telegram, log } = deps;
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

  /** Sends to the chats still missing the Alert; true once it is done with (delivered or given up on). */
  const deliver = async (loaded: AlertDoc, now: Date): Promise<boolean> => {
    // Re-read: the Alert may have been dropped (its Incident closed, its Monitor deleted) since the outbox was loaded.
    const alert = await outbox(db).findOne({ _id: loaded._id });
    if (!alert) return true;
    // A chat unlinked since the Alert was enqueued no longer gets it.
    const linked = new Set(
      (await listLinkedChats(db, alert.ownerId)).map((c) => c.chatId),
    );
    const failed: number[] = [];
    /** Chats that got the Alert in this dispatch, so a group migrating onto one of them isn't sent it twice. */
    const delivered = new Set<number>();
    /** Sends to one chat; a chat that moved is followed once, so two migration answers in a row can't loop. */
    const send = async (
      chatId: number,
      followMigration = true,
    ): Promise<void> => {
      if (delivered.has(chatId)) return;
      try {
        await telegram.sendMessage(chatId, alert.text, alert.options ?? {});
        delivered.add(chatId);
      } catch (err) {
        if (err instanceof TelegramChatMigratedError && followMigration) {
          // The group became a supergroup: follow it and send to the new id at once.
          try {
            await migrateChat(db, chatId, err.newChatId);
          } catch (migrateErr) {
            // Retried with the old id: Telegram answers the same and the migration is followed again.
            failed.push(chatId);
            log.warn(
              { err: migrateErr, chatId, newChatId: err.newChatId },
              "Following a group upgraded to a supergroup failed",
            );
            return;
          }
          log.warn(
            { chatId, newChatId: err.newChatId },
            "Linked chat moved: the group was upgraded to a supergroup",
          );
          await send(err.newChatId, false);
        } else if (err instanceof TelegramForbiddenError) {
          // The bot was blocked or removed: retrying can't help, and the chat is gone for every owner.
          await unlinkChat(db, chatId);
          log.warn(
            { chatId, monitorId: String(alert.monitorId) },
            "Linked chat unlinked: Telegram answered 403 (bot blocked or removed)",
          );
        } else {
          failed.push(chatId);
        }
      }
    };
    for (const chatId of alert.chatIds.filter((id) => linked.has(id))) {
      await send(chatId);
    }
    const attempts = alert.attempts + 1;
    const firstFailedAt = alert.firstFailedAt ?? now;
    const giveUpAt = firstFailedAt.getTime() + ALERT_RETRY_WINDOW_MS;
    const givingUp = failed.length > 0 && now.getTime() >= giveUpAt;
    if (failed.length === 0 || givingUp) {
      await outbox(db).deleteOne({ _id: alert._id });
      if (givingUp) {
        log.warn(
          {
            monitorId: String(alert.monitorId),
            kind: alert.kind,
            chatIds: failed,
            attempts,
          },
          `Alert dropped: Telegram send kept failing for ${ALERT_RETRY_WINDOW_MS / 60_000} min`,
        );
      }
      return true;
    }
    const delay = FIRST_RETRY_DELAY_MS * 2 ** (attempts - 1);
    // Remove only the chats done with, rather than writing `failed` back: a group upgraded to a supergroup
    // while this dispatch ran has had its id replaced in the outbox, and the old id mustn't come back.
    const stillFailing = new Set(failed);
    const done = [...alert.chatIds, ...delivered].filter(
      (id) => !stillFailing.has(id),
    );
    await outbox(db).updateOne(
      { _id: alert._id },
      {
        $pull: { chatIds: { $in: done } },
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

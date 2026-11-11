import { MongoServerError, ObjectId, type Db, type Filter } from "mongodb";
import { parseObjectId } from "./ids.js";
import type { KeyedLock } from "./keyed-lock.js";

/** Fields every Alert channel has, whatever its kind. */
interface AlertChannelBase {
  _id: ObjectId;
  ownerId: ObjectId;
  name: string;
  createdAt: Date;
  /** Set when the channel's Alerts kept failing (Failing); null while they get through. */
  failingSince: Date | null;
  lastError: string | null;
}

/** A Linked chat: a Telegram chat. */
export interface TelegramChannelDoc extends AlertChannelBase {
  kind: "telegram";
  chatId: number;
}

/** One document of `alertChannels`. New kinds join this union and `CHANNEL_KIND_LABELS`. */
export type AlertChannelDoc = TelegramChannelDoc;

export type AlertChannelKind = AlertChannelDoc["kind"];

/** The Alert channel of this kind. */
export type AlertChannelOf<K extends AlertChannelKind> = Extract<
  AlertChannelDoc,
  { kind: K }
>;

/** How each kind is called in the UI. */
export const CHANNEL_KIND_LABELS: Record<AlertChannelKind, string> = {
  telegram: "Telegram",
};

/** Longest Alert channel name, in characters. */
export const MAX_CHANNEL_NAME_LENGTH = 100;

export const alertChannels = (db: Db) =>
  db.collection<AlertChannelDoc>("alertChannels");

/** Where Linked chats were kept before Alert channels existed. */
interface LegacyLinkedChatDoc {
  _id: ObjectId;
  ownerId: ObjectId;
  chatId: number;
  title: string;
  linkedAt: Date;
}

export async function ensureAlertChannelIndexes(db: Db): Promise<void> {
  await Promise.all([
    alertChannels(db).createIndex({ ownerId: 1, createdAt: 1, _id: 1 }),
    // One Linked chat per Telegram chat and User.
    alertChannels(db).createIndex(
      { ownerId: 1, chatId: 1 },
      { unique: true, partialFilterExpression: { kind: "telegram" } },
    ),
    alertChannels(db).createIndex(
      { chatId: 1 },
      { partialFilterExpression: { kind: "telegram" } },
    ),
  ]);
}

/**
 * Moves Linked chats stored before Alert channels existed into `alertChannels`, keeping their ids. Each is removed
 * from the old collection once moved, so running it again changes nothing.
 */
export async function migrateLinkedChats(db: Db): Promise<void> {
  const legacy = db.collection<LegacyLinkedChatDoc>("linkedChats");
  for (const chat of await legacy.find({}).toArray()) {
    try {
      await alertChannels(db).updateOne(
        { _id: chat._id },
        {
          $setOnInsert: {
            ownerId: chat.ownerId,
            kind: "telegram",
            name: chat.title,
            chatId: chat.chatId,
            createdAt: chat.linkedAt,
            failingSince: null,
            lastError: null,
          },
        },
        { upsert: true },
      );
    } catch (err) {
      // The User already has this chat as an Alert channel: that one stays.
      if (!(err instanceof MongoServerError && err.code === 11000)) throw err;
    }
    await legacy.deleteOne({ _id: chat._id });
  }
}

/** The User's Alert channels of every kind, oldest first. */
export function listAlertChannels(
  db: Db,
  ownerId: ObjectId,
): Promise<AlertChannelDoc[]> {
  return alertChannels(db)
    .find({ ownerId })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
}

/** One of the User's Alert channels by id; null when it isn't theirs or doesn't exist. */
export async function findAlertChannel(
  db: Db,
  ownerId: ObjectId,
  id: string,
): Promise<AlertChannelDoc | null> {
  const _id = parseObjectId(id);
  if (!_id) return null;
  return alertChannels(db).findOne({ _id, ownerId });
}

/** The trimmed name, or null when it is empty or too long. */
export function validChannelName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length > 0 && name.length <= MAX_CHANNEL_NAME_LENGTH
    ? name
    : null;
}

/** Renames one of the User's Alert channels. Returns it renamed, or null when it isn't theirs or doesn't exist. */
export async function renameAlertChannel(
  db: Db,
  ownerId: ObjectId,
  id: string,
  name: string,
): Promise<AlertChannelDoc | null> {
  const _id = parseObjectId(id);
  if (!_id) return null;
  return alertChannels(db).findOneAndUpdate(
    { _id, ownerId },
    { $set: { name } },
    { returnDocument: "after" },
  );
}

/** Removes one of the User's Alert channels. Returns it, or null when it isn't theirs or doesn't exist. */
export async function removeAlertChannel(
  db: Db,
  ownerId: ObjectId,
  id: string,
): Promise<AlertChannelDoc | null> {
  const _id = parseObjectId(id);
  if (!_id) return null;
  return alertChannels(db).findOneAndDelete({ _id, ownerId });
}

/** The User already has as many Alert channels as their limit allows. */
export class AlertChannelLimitError extends Error {
  constructor(readonly limit: number) {
    super(`You can have at most ${limit} Alert channels.`);
  }
}

/**
 * Adds an Alert channel within the User's limit. `existing` matches a channel of the same owner the new one would
 * duplicate: then nothing is added (and the limit isn't checked). Count and insert run under the owner's lock, so
 * parallel adds can't pass the limit. Throws AlertChannelLimitError when the User is at the limit.
 */
export async function addAlertChannel(
  db: Db,
  lock: KeyedLock,
  channel: AlertChannelDoc,
  options: {
    limit: number;
    existing?: Filter<AlertChannelDoc>;
  },
): Promise<void> {
  const { ownerId } = channel;
  await lock.run(`alert-channels:${String(ownerId)}`, async () => {
    if (options.existing) {
      const found = await alertChannels(db).findOne({
        ...options.existing,
        ownerId,
      });
      if (found) return;
    }
    if (
      (await alertChannels(db).countDocuments({ ownerId })) >= options.limit
    ) {
      throw new AlertChannelLimitError(options.limit);
    }
    await alertChannels(db).insertOne(channel);
  });
}

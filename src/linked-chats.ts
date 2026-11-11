import { randomInt } from "node:crypto";
import { MongoServerError, ObjectId, type Collection, type Db } from "mongodb";
import {
  addAlertChannel,
  alertChannels,
  type TelegramChannelDoc,
} from "./alert-channels.js";
import type { KeyedLock } from "./keyed-lock.js";
import { pullFromMonitors } from "./monitor-alert-channels.js";

export const LINK_CODE_LENGTH = 8;
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;
/** No 0/O or 1/I, so a code read off a screen is typed right. */
const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface LinkCodeDoc {
  /** The code itself. */
  _id: string;
  ownerId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
  used: boolean;
}

const linkCodes = (db: Db) => db.collection<LinkCodeDoc>("linkCodes");
/** Linked chats: the Alert channels of kind `telegram`. */
const linkedChats = (db: Db) =>
  alertChannels(db) as unknown as Collection<TelegramChannelDoc>;
const TELEGRAM = { kind: "telegram" } as const;

export async function ensureLinkCodeIndexes(db: Db): Promise<void> {
  await Promise.all([
    linkCodes(db).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    linkCodes(db).createIndex({ ownerId: 1, createdAt: -1 }),
  ]);
}

function randomLinkCode(): string {
  let code = "";
  for (let i = 0; i < LINK_CODE_LENGTH; i++) {
    code += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  }
  return code;
}

/** Issues a fresh Link code for the User. Their earlier unused codes stop working, so only the one on screen is live. */
export async function createLinkCode(
  db: Db,
  ownerId: ObjectId,
  now: Date,
): Promise<LinkCodeDoc> {
  await linkCodes(db).updateMany(
    { ownerId, used: false },
    { $set: { used: true } },
  );
  for (;;) {
    const doc: LinkCodeDoc = {
      _id: randomLinkCode(),
      ownerId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + LINK_CODE_TTL_MS),
      used: false,
    };
    try {
      await linkCodes(db).insertOne(doc);
      return doc;
    } catch (err) {
      // Collision with a live code: draw again.
      if (err instanceof MongoServerError && err.code === 11000) continue;
      throw err;
    }
  }
}

/** The User's newest Link code that can still be used, if any. */
export function findActiveLinkCode(
  db: Db,
  ownerId: ObjectId,
  now: Date,
): Promise<LinkCodeDoc | null> {
  return linkCodes(db).findOne(
    { ownerId, used: false, expiresAt: { $gt: now } },
    { sort: { createdAt: -1 } },
  );
}

/** Marks the code used and returns its owner, or null when it is unknown, used or expired. */
export async function redeemLinkCode(
  db: Db,
  code: string,
  now: Date,
): Promise<ObjectId | null> {
  const doc = await linkCodes(db).findOneAndUpdate(
    { _id: code.trim().toUpperCase(), used: false, expiresAt: { $gt: now } },
    { $set: { used: true } },
  );
  return doc?.ownerId ?? null;
}

/**
 * Links the chat to the User as an Alert channel named after the chat. Linking an already Linked chat again changes
 * nothing: it keeps the name the User gave it. Throws AlertChannelLimitError when the User has no Alert channel left.
 */
export async function linkChat(
  db: Db,
  lock: KeyedLock,
  chat: { ownerId: ObjectId; chatId: number; title: string; limit: number },
  now: Date,
): Promise<void> {
  await addAlertChannel(
    db,
    lock,
    {
      _id: new ObjectId(),
      ownerId: chat.ownerId,
      ...TELEGRAM,
      name: chat.title,
      chatId: chat.chatId,
      createdAt: now,
      failingSince: null,
      lastError: null,
    },
    { limit: chat.limit, existing: { ...TELEGRAM, chatId: chat.chatId } },
  );
}

/** Every User's Linked chat that is this Telegram chat: its owner and Alert channel id, earliest linked first. */
export async function linkedChatsOf(
  db: Db,
  chatId: number,
): Promise<Array<{ ownerId: ObjectId; channelId: ObjectId }>> {
  const docs = await linkedChats(db)
    .find({ ...TELEGRAM, chatId })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
  return docs.map((d) => ({ ownerId: d.ownerId, channelId: d._id }));
}

/** Removes every Link of this Telegram chat, also from Monitors' chosen lists. Returns how many were removed. */
export async function unlinkChat(db: Db, chatId: number): Promise<number> {
  const ids = (
    await linkedChats(db)
      .find({ ...TELEGRAM, chatId }, { projection: { _id: 1 } })
      .toArray()
  ).map((d) => d._id);
  if (ids.length === 0) return 0;
  const res = await linkedChats(db).deleteMany({ _id: { $in: ids } });
  await pullFromMonitors(db, ids);
  return res.deletedCount;
}

/** The User's Linked chat for this Telegram chat, if any. */
export function findLinkedChatByChatId(
  db: Db,
  ownerId: ObjectId,
  chatId: number,
): Promise<TelegramChannelDoc | null> {
  return linkedChats(db).findOne({ ...TELEGRAM, ownerId, chatId });
}

/**
 * Moves every owner's Linked chat `fromChatId` to `toChatId` (a group upgraded to a supergroup); a moved chat keeps
 * its Alert channel id. An owner who already has the new id as a Linked chat keeps that one: the old one is removed
 * and returned as `{ from, to }`, so whatever was addressed to it can follow.
 */
export async function moveLinkedChats(
  db: Db,
  fromChatId: number,
  toChatId: number,
): Promise<Array<{ from: ObjectId; to: ObjectId }>> {
  const merged: Array<{ from: ObjectId; to: ObjectId }> = [];
  for (const link of await linkedChats(db)
    .find({ ...TELEGRAM, chatId: fromChatId })
    .toArray()) {
    try {
      await linkedChats(db).updateOne(
        { _id: link._id },
        { $set: { chatId: toChatId } },
      );
    } catch (err) {
      if (!(err instanceof MongoServerError && err.code === 11000)) throw err;
      const kept = await findLinkedChatByChatId(db, link.ownerId, toChatId);
      await linkedChats(db).deleteOne({ _id: link._id });
      if (kept) merged.push({ from: link._id, to: kept._id });
    }
  }
  return merged;
}

/** How many Linked chats each User has, keyed by owner id (the Admin page). Owners without any are absent. */
export async function countLinkedChatsByOwner(
  db: Db,
): Promise<Map<string, number>> {
  const groups = await linkedChats(db)
    .aggregate<{
      _id: ObjectId;
      count: number;
    }>([
      { $match: TELEGRAM },
      { $group: { _id: "$ownerId", count: { $sum: 1 } } },
    ])
    .toArray();
  return new Map(groups.map((g) => [String(g._id), g.count]));
}

/** How many Linked chats the instance has, across all Users (the Admin page). */
export function countLinkedChats(db: Db): Promise<number> {
  return linkedChats(db).countDocuments(TELEGRAM);
}

import { randomInt } from "node:crypto";
import { MongoServerError, ObjectId, type Db } from "mongodb";
import { parseObjectId } from "./ids.js";

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

export interface LinkedChatDoc {
  _id: ObjectId;
  ownerId: ObjectId;
  chatId: number;
  title: string;
  linkedAt: Date;
}

const linkCodes = (db: Db) => db.collection<LinkCodeDoc>("linkCodes");
const linkedChats = (db: Db) => db.collection<LinkedChatDoc>("linkedChats");

export async function ensureLinkedChatIndexes(db: Db): Promise<void> {
  await Promise.all([
    linkCodes(db).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    linkCodes(db).createIndex({ ownerId: 1, createdAt: -1 }),
    linkedChats(db).createIndex({ ownerId: 1, chatId: 1 }, { unique: true }),
    linkedChats(db).createIndex({ chatId: 1 }),
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

/** Links the chat to the User; linking an already Linked chat again just refreshes its title. */
export async function linkChat(
  db: Db,
  chat: { ownerId: ObjectId; chatId: number; title: string },
  now: Date,
): Promise<void> {
  await linkedChats(db).updateOne(
    { ownerId: chat.ownerId, chatId: chat.chatId },
    {
      $set: { title: chat.title },
      $setOnInsert: { _id: new ObjectId(), linkedAt: now },
    },
    { upsert: true },
  );
}

export function listLinkedChats(
  db: Db,
  ownerId: ObjectId,
): Promise<LinkedChatDoc[]> {
  return linkedChats(db)
    .find({ ownerId })
    .sort({ linkedAt: 1, _id: 1 })
    .toArray();
}

/** Owners of every Link of this Telegram chat. */
export async function ownersOfChat(
  db: Db,
  chatId: number,
): Promise<ObjectId[]> {
  const docs = await linkedChats(db)
    .find({ chatId })
    .sort({ linkedAt: 1 })
    .toArray();
  return docs.map((d) => d.ownerId);
}

/** Removes every Link of this Telegram chat. Returns how many were removed. */
export async function unlinkChat(db: Db, chatId: number): Promise<number> {
  const res = await linkedChats(db).deleteMany({ chatId });
  return res.deletedCount;
}

/** One of the User's Linked chats by id; null when it isn't theirs or doesn't exist. */
export async function findLinkedChat(
  db: Db,
  ownerId: ObjectId,
  id: string,
): Promise<LinkedChatDoc | null> {
  const _id = parseObjectId(id);
  if (!_id) return null;
  return linkedChats(db).findOne({ _id, ownerId });
}

/** Removes one of the User's Linked chats by id. Returns it, or null when it isn't theirs or doesn't exist. */
export async function removeLinkedChat(
  db: Db,
  ownerId: ObjectId,
  id: string,
): Promise<LinkedChatDoc | null> {
  const _id = parseObjectId(id);
  if (!_id) return null;
  return linkedChats(db).findOneAndDelete({ _id, ownerId });
}

/** How many Linked chats each User has, keyed by owner id (the Admin page). Owners without any are absent. */
export async function countLinkedChatsByOwner(
  db: Db,
): Promise<Map<string, number>> {
  const groups = await linkedChats(db)
    .aggregate<{
      _id: ObjectId;
      count: number;
    }>([{ $group: { _id: "$ownerId", count: { $sum: 1 } } }])
    .toArray();
  return new Map(groups.map((g) => [String(g._id), g.count]));
}

/** How many Linked chats the instance has, across all Users (the Admin page). */
export function countLinkedChats(db: Db): Promise<number> {
  return linkedChats(db).countDocuments();
}

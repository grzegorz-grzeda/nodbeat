import { hash, verify } from "@node-rs/argon2";
import { MongoServerError, ObjectId, type Db } from "mongodb";
import type { Clock } from "./clock.js";

export const DEFAULT_TIME_ZONE = "Europe/Warsaw";

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
/** Follows the OS; also what logged-out pages render. */
export const DEFAULT_THEME: Theme = "system";

export interface UserDoc {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  isAdmin: boolean;
  timeZone: string;
  /** Missing on Users created before themes existed: means `"system"`. */
  theme?: Theme;
  createdAt: Date;
}

export interface NewUser {
  email: string;
  password: string;
  isAdmin: boolean;
  timeZone?: string;
}

export class UserError extends Error {
  override name = "UserError";
}

/** @node-rs/argon2 exports Algorithm as a const enum, which isolated modules can't reference; 2 = Argon2id. */
const ARGON2ID = 2;
export const MIN_PASSWORD_LENGTH = 8;

const users = (db: Db) => db.collection<UserDoc>("users");

export async function ensureUserIndexes(db: Db): Promise<void> {
  await users(db).createIndex({ email: 1 }, { unique: true });
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Throws a UserError when the password breaks the rules every User's password follows. */
function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new UserError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
}

/** Replaces the User's password; throws a UserError when the new one breaks the rules. */
export async function setUserPassword(
  db: Db,
  id: ObjectId,
  password: string,
): Promise<void> {
  checkPassword(password);
  await users(db).updateOne(
    { _id: id },
    { $set: { passwordHash: await hashPassword(password) } },
  );
}

export async function createUser(
  db: Db,
  clock: Clock,
  input: NewUser,
): Promise<UserDoc> {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new UserError(`Invalid email: ${input.email}`);
  }
  checkPassword(input.password);
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  if (!isValidTimeZone(timeZone)) {
    throw new UserError(`Unknown time zone: ${timeZone}`);
  }

  const doc: UserDoc = {
    _id: new ObjectId(),
    email,
    passwordHash: await hashPassword(input.password),
    isAdmin: input.isAdmin,
    timeZone,
    createdAt: clock.now(),
  };
  try {
    await users(db).insertOne(doc);
    return doc;
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      throw new UserError(`A User with email ${email} already exists`);
    }
    throw err;
  }
}

export async function findUserById(
  db: Db,
  id: ObjectId,
): Promise<UserDoc | null> {
  return users(db).findOne({ _id: id });
}

/** Returns the User when the email and password match, null otherwise. */
export async function authenticate(
  db: Db,
  email: string,
  password: string,
): Promise<UserDoc | null> {
  const user = await users(db).findOne({ email: normalizeEmail(email) });
  // Verify against a dummy hash for unknown emails so timing doesn't reveal which emails exist.
  const passwordHash = user?.passwordHash ?? (await dummyHash());
  const ok = await verify(passwordHash, password).catch(() => false);
  return ok && user ? user : null;
}

function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: ARGON2ID });
}

let dummy: Promise<string> | undefined;
function dummyHash(): Promise<string> {
  dummy ??= hashPassword("nodbeat-dummy-password");
  return dummy;
}

/** Sets the User's time zone. Returns false (and changes nothing) for a time zone Intl doesn't know. */
export async function setUserTimeZone(
  db: Db,
  id: ObjectId,
  timeZone: string,
): Promise<boolean> {
  if (!isValidTimeZone(timeZone)) return false;
  await users(db).updateOne({ _id: id }, { $set: { timeZone } });
  return true;
}

export function isTheme(value: unknown): value is Theme {
  return (THEMES as readonly unknown[]).includes(value);
}

/** The User's theme; Users who never picked one get the default. */
export function themeOf(user: UserDoc): Theme {
  return user.theme ?? DEFAULT_THEME;
}

/** Sets the User's theme; callers check it with `isTheme` first. */
export async function setUserTheme(
  db: Db,
  id: ObjectId,
  theme: Theme,
): Promise<void> {
  await users(db).updateOne({ _id: id }, { $set: { theme } });
}

/** The emails of these Users, keyed by id; deleted Users are absent. */
export async function emailsByUserId(
  db: Db,
  ids: ObjectId[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const found = await users(db)
    .find({ _id: { $in: ids } }, { projection: { email: 1 } })
    .toArray();
  return new Map(found.map((u) => [String(u._id), u.email]));
}

/** Every User's id and email (the Admin page). */
export function listUserEmails(
  db: Db,
): Promise<Array<Pick<UserDoc, "_id" | "email">>> {
  return users(db)
    .find({}, { projection: { email: 1 } })
    .sort({ createdAt: 1 })
    .toArray();
}

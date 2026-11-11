import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db, ObjectId } from "mongodb";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";
import { formatAgo, formatDuration } from "./format.js";
import {
  linkChat,
  ownersOfChat,
  redeemLinkCode,
  unlinkChat,
} from "./linked-chats.js";
import { STATE_LABELS } from "./monitor-state.js";
import { listMonitors } from "./monitors.js";
import { SlidingWindowLimiter } from "./rate-limit.js";
import type { ChatMemberStatus, TelegramClient } from "./telegram.js";
import { findUserById } from "./users.js";

const WEBHOOK_PATH = "/telegram/webhook";
const SECRET_HEADER = "x-telegram-bot-api-secret-token";
/** Guesses at Link codes allowed per chat. */
const START_MAX_ATTEMPTS = 10;
const START_WINDOW_MS = 10 * 60 * 1000;
/** Telegram rejects longer messages. */
const MAX_MESSAGE_LENGTH = 4096;
/** Members allowed to use /status and /unlink in a group. */
const ADMIN_STATUSES: ReadonlySet<ChatMemberStatus> = new Set([
  "creator",
  "administrator",
]);

interface TelegramChat {
  id: number;
  type?: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

/** The parts of a Telegram Update the bot reads. */
interface Update {
  message?: {
    text?: unknown;
    chat?: { id?: unknown };
    from?: { id?: unknown };
  };
}

type Command = (
  chat: TelegramChat,
  arg: string,
  senderId: number | undefined,
) => Promise<string>;

function chatTitle(chat: TelegramChat): string {
  if (chat.title) return chat.title;
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ");
  if (name) return name;
  if (chat.username) return `@${chat.username}`;
  return `Chat ${chat.id}`;
}

/** "/start@nodbeat_bot ABC" → { command: "start", arg: "ABC" }. */
function parseCommand(text: string): { command: string; arg: string } | null {
  const match = /^\/([A-Za-z0-9_]+)(?:@\S+)?(?:\s+([\s\S]*))?$/.exec(
    text.trim(),
  );
  if (!match) return null;
  return { command: match[1]!.toLowerCase(), arg: (match[2] ?? "").trim() };
}

function truncate(text: string): string {
  if (text.length <= MAX_MESSAGE_LENGTH) return text;
  return `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
}

/** The Telegram webhook and the bot commands behind it. Registers the webhook with Telegram on startup. */
export function registerTelegramBot(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; telegram: TelegramClient; config: Config },
): void {
  const { db, clock, telegram, config } = deps;
  const expectedSecret = Buffer.from(config.telegramWebhookSecret);
  const startLimiter = new SlidingWindowLimiter(
    clock,
    START_MAX_ATTEMPTS,
    START_WINDOW_MS,
  );
  const settingsUrl = `${config.publicBaseUrl}/settings`;
  const howToLink = `Generate a Link code at ${settingsUrl} and send /start <code> here.`;
  const notLinked = `This chat isn't linked to a nodbeat account. ${howToLink}`;
  const help = `nodbeat commands:\n/start <code> — link this chat\n/status — your Monitors and their states\n/unlink — stop Alerts in this chat`;

  const fromTelegram = (req: FastifyRequest): boolean => {
    const given = req.headers[SECRET_HEADER];
    if (typeof given !== "string") return false;
    const givenBuf = Buffer.from(given);
    return (
      givenBuf.length === expectedSecret.length &&
      timingSafeEqual(givenBuf, expectedSecret)
    );
  };

  const startCommand = async (
    chat: TelegramChat,
    code: string,
  ): Promise<string> => {
    if (!code) return `To link this chat: ${howToLink}`;
    if (!startLimiter.tryAcquire(String(chat.id))) {
      return `Too many attempts. Try again in ${formatDuration(START_WINDOW_MS / 1000)}.`;
    }
    const now = clock.now();
    const ownerId = await redeemLinkCode(db, code, now);
    const owner = ownerId && (await findUserById(db, ownerId));
    if (!owner) {
      return `That Link code is invalid, already used or expired. Generate a new one at ${settingsUrl}.`;
    }
    await linkChat(
      db,
      { ownerId: owner._id, chatId: chat.id, title: chatTitle(chat) },
      now,
    );
    return "This chat is now linked to your nodbeat account. Alerts will arrive here.";
  };

  const monitorStatesOf = async (
    ownerId: ObjectId,
    now: Date,
  ): Promise<string> => {
    const list = await listMonitors(db, ownerId);
    if (list.length === 0) return "No Monitors yet.";
    return list
      .map(
        (m) =>
          `${m.name}: ${STATE_LABELS[m.state]} (last Heartbeat ${formatAgo(m.lastHeartbeatAt, now)})`,
      )
      .join("\n");
  };

  const statusCommand = async (chat: TelegramChat): Promise<string> => {
    const owners = await ownersOfChat(db, chat.id);
    if (owners.length === 0) return notLinked;
    const now = clock.now();
    if (owners.length === 1) return monitorStatesOf(owners[0]!, now);
    // A group linked by several Users: one numbered section per User, never labelled by email.
    const sections = await Promise.all(
      owners.map(
        async (ownerId, i) =>
          `Account ${i + 1}\n${await monitorStatesOf(ownerId, now)}`,
      ),
    );
    return sections.join("\n\n");
  };

  const unlinkCommand = async (chat: TelegramChat): Promise<string> =>
    (await unlinkChat(db, chat.id)) > 0
      ? "This chat is unlinked. No more Alerts will arrive here."
      : notLinked;

  /** In a group only its Telegram admins may read the Monitors or cut off the Alerts. */
  const adminsOnly =
    (command: Command): Command =>
    async (chat, arg, senderId) => {
      if (chat.type === "private") return command(chat, arg, senderId);
      const allowed =
        senderId !== undefined &&
        ADMIN_STATUSES.has(await telegram.getChatMember(chat.id, senderId));
      return allowed
        ? command(chat, arg, senderId)
        : "Only group admins can use this command.";
    };

  const commands: Record<string, Command> = {
    // Open to any member: it needs a valid Link code anyway.
    start: startCommand,
    status: adminsOnly(statusCommand),
    unlink: adminsOnly(unlinkCommand),
  };

  const handle = async (update: Update): Promise<void> => {
    const text = update.message?.text;
    const chat = update.message?.chat as TelegramChat | undefined;
    if (typeof chat?.id !== "number" || typeof text !== "string") return;
    const parsed = parseCommand(text);
    if (!parsed) return;
    const command = commands[parsed.command];
    let replyText: string;
    const senderId = update.message?.from?.id;
    if (command) {
      replyText = await command(
        chat,
        parsed.arg,
        typeof senderId === "number" ? senderId : undefined,
      );
    }
    // In groups an unknown command is likely meant for another bot.
    else if (chat.type === "private") replyText = help;
    else return;
    await telegram.sendMessage(chat.id, truncate(replyText));
  };

  app.post(WEBHOOK_PATH, { config: { csrf: false } }, async (req, reply) => {
    if (!fromTelegram(req)) return reply.code(401).send();
    try {
      await handle((req.body ?? {}) as Update);
    } catch (err) {
      // Always acknowledge: a non-2xx makes Telegram redeliver the same Update over and over.
      req.log.error({ err }, "telegram update failed");
    }
    return reply.code(200).send();
  });

  // Not awaited: a slow or unreachable Telegram must not hold up startup and Heartbeat intake.
  telegram
    .setWebhook(
      `${config.publicBaseUrl}${WEBHOOK_PATH}`,
      config.telegramWebhookSecret,
    )
    .catch((err: unknown) =>
      app.log.error({ err }, "registering the Telegram webhook failed"),
    );
}

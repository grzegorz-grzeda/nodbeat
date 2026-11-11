import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db, ObjectId } from "mongodb";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";
import { formatAgo, formatDuration } from "./format.js";
import { AlertChannelLimitError, listAlertChannels } from "./alert-channels.js";
import { migrateChat } from "./alerts.js";
import type { KeyedLock } from "./keyed-lock.js";
import { limitsFor } from "./limits.js";
import {
  linkChat,
  linkedChatsOf,
  redeemLinkCode,
  unlinkChat,
} from "./linked-chats.js";
import { channelsOfMonitor } from "./monitor-alert-channels.js";
import { STATE_LABELS } from "./monitor-state.js";
import { listMonitors } from "./monitors.js";
import { SlidingWindowLimiter } from "./rate-limit.js";
import type {
  BotCommand,
  ChatMemberStatus,
  TelegramClient,
} from "./telegram.js";
import { findUserById } from "./users.js";

const WEBHOOK_PATH = "/telegram/webhook";
/** The bot's command menu, set at every startup. */
const COMMAND_MENU: BotCommand[] = [
  { command: "start", description: "Link this chat with a code from Settings" },
  { command: "status", description: "Show your Monitors" },
  { command: "unlink", description: "Stop Alerts in this chat" },
];
const SECRET_HEADER = "x-telegram-bot-api-secret-token";
/** Guesses at Link codes allowed per chat. */
const START_MAX_ATTEMPTS = 10;
const START_WINDOW_MS = 10 * 60 * 1000;
/** Telegram rejects longer messages. */
const MAX_MESSAGE_LENGTH = 4096;
/** Members allowed to use /status and /unlink in a group. */
const GROUP_ADMIN_STATUSES: ReadonlySet<ChatMemberStatus> = new Set([
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
    /** Set on the service message of a group upgraded to a supergroup. */
    migrate_to_chat_id?: unknown;
  };
  /** The bot's own membership in a chat changed. */
  my_chat_member?: {
    chat?: { id?: unknown };
    new_chat_member?: { status?: unknown };
  };
}

/** The bot's membership statuses that mean it can no longer write to the chat. */
const REMOVED_STATUSES: ReadonlySet<ChatMemberStatus> = new Set([
  "left",
  "kicked",
]);

/** A bot command as sent: the chat, the text after the command and the sending Telegram user. */
interface CommandMessage {
  chat: TelegramChat;
  arg: string;
  senderId: number | undefined;
}

type Command = (message: CommandMessage) => Promise<string>;

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
  deps: {
    db: Db;
    clock: Clock;
    telegram: TelegramClient;
    config: Config;
    /** Guards the per-User Alert channel limit. */
    channelLock: KeyedLock;
  },
): void {
  const { db, clock, telegram, config, channelLock } = deps;
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

  const startCommand: Command = async ({ chat, arg: code }) => {
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
    try {
      await linkChat(
        db,
        channelLock,
        {
          ownerId: owner._id,
          chatId: chat.id,
          title: chatTitle(chat),
          limit: limitsFor(owner).maxAlertChannels,
        },
        now,
      );
    } catch (err) {
      if (!(err instanceof AlertChannelLimitError)) throw err;
      return `You already have ${err.limit} Alert channels, the most allowed. Remove one at ${settingsUrl} first.`;
    }
    return "This chat is now linked to your nodbeat account. Alerts will arrive here.";
  };

  /** The owner's Monitors whose Alert channels include `channelId` (the chat's Linked chat of this owner). */
  const monitorStatesOf = async (
    { ownerId, channelId }: { ownerId: ObjectId; channelId: ObjectId },
    now: Date,
  ): Promise<string> => {
    const [all, channels] = await Promise.all([
      listMonitors(db, ownerId),
      listAlertChannels(db, ownerId),
    ]);
    if (all.length === 0) return "No Monitors yet.";
    const list = all.filter((m) =>
      channelsOfMonitor(m, channels).some((c) => c._id.equals(channelId)),
    );
    if (list.length === 0) return "No Monitors alert this chat.";
    return list
      .map(
        (m) =>
          `${m.name}: ${STATE_LABELS[m.state]} (last Heartbeat ${formatAgo(m.lastHeartbeatAt, now)})`,
      )
      .join("\n");
  };

  const statusCommand: Command = async ({ chat }) => {
    const owners = await linkedChatsOf(db, chat.id);
    if (owners.length === 0) return notLinked;
    const now = clock.now();
    if (owners.length === 1) return monitorStatesOf(owners[0]!, now);
    // A group linked by several Users: one numbered section per User, never labelled by email.
    const sections = await Promise.all(
      owners.map(
        async (link, i) =>
          `Account ${i + 1}\n${await monitorStatesOf(link, now)}`,
      ),
    );
    return sections.join("\n\n");
  };

  const unlinkCommand: Command = async ({ chat }) =>
    (await unlinkChat(db, chat.id)) > 0
      ? "This chat is unlinked. No more Alerts will arrive here."
      : notLinked;

  const isGroupAdmin = async (
    chatId: number,
    senderId: number | undefined,
  ): Promise<boolean> => {
    if (senderId === undefined) return false;
    try {
      return GROUP_ADMIN_STATUSES.has(
        await telegram.getChatMember(chatId, senderId),
      );
    } catch (err) {
      // Fail closed: without an answer from Telegram the sender is not an admin.
      app.log.warn({ err }, "telegram getChatMember failed");
      return false;
    }
  };

  /** In a group only its Telegram admins may read the Monitors or cut off the Alerts. */
  const groupAdminsOnly =
    (command: Command): Command =>
    async (message) => {
      if (message.chat.type === "private") return command(message);
      return (await isGroupAdmin(message.chat.id, message.senderId))
        ? command(message)
        : "Only group admins can use this command.";
    };

  const commands: Record<string, Command> = {
    // Open to any member: it needs a valid Link code anyway.
    start: startCommand,
    status: groupAdminsOnly(statusCommand),
    unlink: groupAdminsOnly(unlinkCommand),
  };

  const handle = async (update: Update): Promise<void> => {
    const member = update.my_chat_member;
    const status = member?.new_chat_member?.status;
    if (
      typeof member?.chat?.id === "number" &&
      typeof status === "string" &&
      REMOVED_STATUSES.has(status)
    ) {
      // The bot was removed from the group or blocked: unlink the chat, the same as /unlink.
      await unlinkChat(db, member.chat.id);
      return;
    }
    const text = update.message?.text;
    const chat = update.message?.chat as TelegramChat | undefined;
    const migratedTo = update.message?.migrate_to_chat_id;
    if (typeof chat?.id === "number" && typeof migratedTo === "number") {
      await migrateChat(db, chat.id, migratedTo);
      return;
    }
    if (typeof chat?.id !== "number" || typeof text !== "string") return;
    const parsed = parseCommand(text);
    if (!parsed) return;
    const command = commands[parsed.command];
    let replyText: string;
    const senderId = update.message?.from?.id;
    if (command) {
      replyText = await command({
        chat,
        arg: parsed.arg,
        senderId: typeof senderId === "number" ? senderId : undefined,
      });
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
      ["message", "my_chat_member"],
    )
    .catch((err: unknown) =>
      app.log.error({ err }, "registering the Telegram webhook failed"),
    );
  telegram
    .setMyCommands(COMMAND_MENU)
    .catch((err: unknown) =>
      app.log.error({ err }, "setting the Telegram command menu failed"),
    );
}

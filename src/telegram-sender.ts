import type { Db } from "mongodb";
import type { TelegramChannelDoc } from "./alert-channels.js";
import { migrateChat, type AlertLog, type AlertSender } from "./alerts.js";
import { findLinkedChatByChatId, unlinkChat } from "./linked-chats.js";
import {
  TelegramChatMigratedError,
  TelegramForbiddenError,
  type TelegramClient,
} from "./telegram.js";

/**
 * Sends Alerts to Linked chats. Follows a group upgraded to a supergroup at once (once per send, so two migration
 * answers in a row can't loop), and unlinks a chat that blocked or removed the bot: retrying can't help there.
 */
export function createTelegramSender(deps: {
  db: Db;
  telegram: TelegramClient;
  log: AlertLog;
}): AlertSender<TelegramChannelDoc> {
  const { db, telegram, log } = deps;

  const send: (
    ...args: [...Parameters<AlertSender<TelegramChannelDoc>>, boolean?]
  ) => Promise<void> = async (
    channel,
    alert,
    attempt,
    followMigration = true,
  ) => {
    const id = String(channel._id);
    if (attempt.delivered.has(id)) return;
    try {
      await telegram.sendMessage(
        channel.chatId,
        alert.text,
        alert.options ?? {},
      );
      attempt.delivered.add(id);
    } catch (err) {
      if (err instanceof TelegramChatMigratedError && followMigration) {
        const { chatId } = channel;
        try {
          await migrateChat(db, chatId, err.newChatId);
        } catch (migrateErr) {
          // Retried with the old id: Telegram answers the same and the migration is followed again.
          attempt.failed.set(id, String(migrateErr));
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
        // The same channel at its new id, or the owner's Linked chat it was merged into.
        const moved = await findLinkedChatByChatId(
          db,
          channel.ownerId,
          err.newChatId,
        );
        if (moved) await send(moved, alert, attempt, false);
      } else if (err instanceof TelegramForbiddenError) {
        // The bot was blocked or removed: the chat is gone for every owner.
        await unlinkChat(db, channel.chatId);
        log.warn(
          { chatId: channel.chatId, monitorId: String(alert.monitorId) },
          "Linked chat unlinked: Telegram answered 403 (bot blocked or removed)",
        );
      } else {
        attempt.failed.set(id, String(err));
      }
    }
  };
  return (channel, alert, attempt) => send(channel, alert, attempt);
}

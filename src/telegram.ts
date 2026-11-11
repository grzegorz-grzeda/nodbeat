/** A Telegram chat member's status, as `getChatMember` reports it. */
export type ChatMemberStatus =
  | "creator"
  | "administrator"
  | "member"
  | "restricted"
  | "left"
  | "kicked"
  | (string & {});

/** The small slice of the Telegram Bot API nodbeat needs. */
export interface TelegramClient {
  /**
   * Rejects with TelegramForbiddenError when Telegram answers 403 (the bot was blocked or removed from the chat),
   * and with TelegramChatMigratedError when the group became a supergroup with a new chat id.
   */
  sendMessage(chatId: number, text: string): Promise<void>;
  getChatMember(chatId: number, userId: number): Promise<ChatMemberStatus>;
  setWebhook(url: string, secretToken: string): Promise<void>;
}

/** Telegram answered HTTP 403: the bot can no longer write to that chat. */
export class TelegramForbiddenError extends Error {
  constructor(method: string) {
    super(`Telegram ${method} failed: HTTP 403`);
    this.name = "TelegramForbiddenError";
  }
}

/** Telegram answered HTTP 400 with `migrate_to_chat_id`: the group was upgraded to a supergroup with a new chat id. */
export class TelegramChatMigratedError extends Error {
  constructor(
    method: string,
    readonly newChatId: number,
  ) {
    super(`Telegram ${method} failed: chat migrated to ${newChatId}`);
    this.name = "TelegramChatMigratedError";
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

export function createHttpTelegramClient(
  botToken: string,
  fetchFn: typeof fetch = fetch,
): TelegramClient {
  const call = async (method: string, body: unknown): Promise<unknown> => {
    const res = await fetchFn(
      `https://api.telegram.org/bot${botToken}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (res.status === 403) throw new TelegramForbiddenError(method);
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as {
        parameters?: { migrate_to_chat_id?: unknown };
      } | null;
      const newChatId = body?.parameters?.migrate_to_chat_id;
      if (typeof newChatId === "number") {
        throw new TelegramChatMigratedError(method, newChatId);
      }
    }
    if (!res.ok) {
      throw new Error(`Telegram ${method} failed: HTTP ${res.status}`);
    }
    return res.json();
  };

  return {
    sendMessage: async (chatId, text) => {
      await call("sendMessage", { chat_id: chatId, text });
    },
    getChatMember: async (chatId, userId) => {
      const body = (await call("getChatMember", {
        chat_id: chatId,
        user_id: userId,
      })) as { result?: { status?: unknown } };
      const status = body.result?.status;
      if (typeof status !== "string") {
        throw new Error("Telegram getChatMember answered without a status");
      }
      return status;
    },
    setWebhook: async (url, secretToken) => {
      await call("setWebhook", { url, secret_token: secretToken });
    },
  };
}

/** The small slice of the Telegram Bot API nodbeat needs. */
export interface TelegramClient {
  sendMessage(chatId: number, text: string): Promise<void>;
  setWebhook(url: string, secretToken: string): Promise<void>;
}

const REQUEST_TIMEOUT_MS = 10_000;

export function createHttpTelegramClient(
  botToken: string,
  fetchFn: typeof fetch = fetch,
): TelegramClient {
  const call = async (method: string, body: unknown): Promise<void> => {
    const res = await fetchFn(
      `https://api.telegram.org/bot${botToken}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      throw new Error(`Telegram ${method} failed: HTTP ${res.status}`);
    }
  };

  return {
    sendMessage: (chatId, text) =>
      call("sendMessage", { chat_id: chatId, text }),
    setWebhook: (url, secretToken) =>
      call("setWebhook", { url, secret_token: secretToken }),
  };
}

# 0028: Bot setup at startup

Spec: 0005
Status: ready-for-agent

**What to build:** nodbeat sets the bot's command menu and limits the webhook to the updates it reads when it starts, so nothing is set up by hand in BotFather.

**Blocked by:** 0027 (it starts reading `my_chat_member`).

- [x] `TelegramClient.setMyCommands`; called at startup with `start`, `status`, `unlink` and their descriptions, not awaited, failures logged
- [x] `setWebhook` sends `allowed_updates: ["message", "my_chat_member"]`
- [x] `docs/deploy.md` drops the manual `/setcommands` step
- [x] Tests: the Telegram fake records both calls with the expected arguments

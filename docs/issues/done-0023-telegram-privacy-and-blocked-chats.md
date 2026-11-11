# 0023: Telegram privacy and blocked chats

Spec: 0004
Status: resolved

**What to build:** The bot never shows emails; in groups only Telegram admins can use `/status` and `/unlink`; a chat that blocked or kicked the bot is unlinked as soon as Telegram answers 403.

**Blocked by:** none.

- [x] `/start` success says "This chat is now linked to your nodbeat account." with no email
- [x] In a group linked by several Users, `/status` sections are numbered ("Account 1", ...), not labelled by email
- [x] `TelegramClient.getChatMember(chatId, userId)`; in non-private chats `/status` and `/unlink` answer only `creator`/`administrator`, others get "Only group admins can use this command."
- [x] `sendMessage` rejects with an error that marks HTTP 403
- [x] The Alert dispatcher unlinks a chat (all its Links) on a 403, doesn't retry it, logs it, and still delivers to the other chats
- [x] Telegram fake: can answer `getChatMember` with a status and fail `sendMessage` with 403
- [x] Tests through the HTTP seam: no email in any bot reply; a group member who isn't an admin can't `/status` or `/unlink`; an admin can; a 403 chat disappears from Settings and isn't retried

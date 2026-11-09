# 0005: Telegram linking and bot commands

Spec: 0001
Status: ready-for-agent

**What to build:** I generate a Link code on the Settings page, send `/start <code>` to the nodbeat bot, and the chat shows up as a Linked chat. In a Linked chat, `/status` lists my Monitors and their states, and `/unlink` disconnects the chat.

**Blocked by:** 0003.

- [x] `POST /telegram/webhook` rejects requests without a matching `X-Telegram-Bot-Api-Secret-Token` header
- [x] Settings page generates an 8-character Link code that works once and expires after 10 minutes
- [x] `/start <code>` links the chat (private or group) to the code's User; reusing or using an expired code is refused with a reply
- [x] A User can have several Linked chats; the Settings page lists them and can remove them
- [x] `/status` replies with the owner's Monitors and their states; `/unlink` removes the Linked chat; both reply helpfully in a chat that isn't linked
- [x] On startup the app registers the webhook with Telegram (through the injected client)
- [x] Tests drive the webhook over HTTP and assert on the replies the Telegram fake records

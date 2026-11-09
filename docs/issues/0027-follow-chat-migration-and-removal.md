# 0027: Follow supergroup migration and bot removal

Spec: 0005
Status: ready-for-agent

**What to build:** A Linked chat keeps getting Alerts after Telegram upgrades the group to a supergroup, and a group that removed the bot is unlinked straight away.

**Blocked by:** 0023 (both change how a failed send is reported and handled).

- [ ] A `message` update with `migrate_to_chat_id` moves every Link of the old chat id, and the old id in pending outbox Alerts, to the new id
- [ ] `sendMessage` failing with `400` + `parameters.migrate_to_chat_id` does the same move and retries the send to the new id at once
- [ ] A `my_chat_member` update with new status `left` or `kicked` unlinks the chat (all its Links)
- [ ] Telegram fake: can fail a send with `400` + `migrate_to_chat_id`
- [ ] Tests through the HTTP seam: after a migration update the chat shows in Settings and the next Alert reaches the new id; an Alert failing with the migration error is delivered to the new id without waiting for a retry; after a `kicked` update the chat is gone from Settings

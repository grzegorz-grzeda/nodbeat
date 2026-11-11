# Spec 0005: Telegram bot improvements

Status: ready-for-agent

Note: stories 9–12 (Alert chats, issue 0031) are wontfix here and moved to spec 0009 (issue 0047). This spec is done once issues 0027–0030 are done.

## Problem Statement

The Telegram bot works for one User with one chat, but it breaks down at the edges:

- When a Telegram group is upgraded to a supergroup, its chat id changes. Sends to the old id fail with `400` and the new id in `migrate_to_chat_id`. nodbeat retries each Alert for an hour, then drops it, and the Linked chat stops getting Alerts without anyone noticing.
- When the bot is removed from a group, Telegram tells nodbeat (`my_chat_member`), but the update is ignored. The chat stays linked until an Alert fails.
- The command menu has to be set up by hand in BotFather, and the webhook receives every kind of update even though the bot reads only messages.
- An Alert says only the name, the state and the time. The Heartbeat message that often explains a Down ("battery 3.1V") isn't in it, and there's no link to the Monitor.
- Up Alerts buzz the phone just like Down Alerts, so a recovery at 3 a.m. wakes me for nothing.
- Every Alert goes to every Linked chat. Once I link a family group for the garden sensors, it also gets my server Alerts, and its `/status` lists my servers.

## Solution

Follow chat id changes and bot removals as they happen, set up the bot at startup, make Alerts more useful and quieter on recovery, and let each Monitor choose its **Alert chats**. The bot stays a read-only notifier: it never changes Monitors.

## User Stories

1. As a User, I want my Linked chat to keep getting Alerts after Telegram upgrades the group to a supergroup, so that I don't silently lose Alerts.
2. As a User, I want a group that removed the bot to be unlinked straight away, so that Settings shows the truth.
3. As the Admin, I want the bot's command menu set up when nodbeat starts, so that I don't have to configure it in BotFather.
4. As the Admin, I want the webhook to receive only the updates the bot reads, so that nodbeat isn't sent traffic it ignores.
5. As a User, I want a Down Alert to include the last Heartbeat message, so that I see why it may have gone Down without opening the web page.
6. As a User, I want every Alert to link to its Monitor page, so that I can get to the details in one tap.
7. As a User, I want the Monitor's name in an Alert to stand out, so that I can see which Monitor it is at a glance.
8. As a User, I want Up Alerts delivered silently, so that a recovery doesn't wake me while a Down still does.
9. As a User, I want to choose which of my Linked chats a Monitor alerts, so that garden sensors go to the family group and servers only to me.
10. As a User, I want a new Monitor to alert all my Linked chats by default, including chats I link later, so that nothing changes unless I choose.
11. As a User, I want to see a warning on the Monitor page and the Dashboard when a Monitor alerts no chat, so that I notice after removing its only chat.
12. As a member of a linked group, I want `/status` to list only the Monitors that alert this chat, so that I see what's relevant to the group and nothing else.

## Implementation Decisions

- **Supergroup migration**: a `message` update with `migrate_to_chat_id` moves every Linked chat with the old chat id to the new one. Pending Alerts in the outbox are moved too. When `sendMessage` fails with `400` and `parameters.migrate_to_chat_id`, the same move happens and the send is retried to the new id at once. `TelegramClient.sendMessage` reports this error with the new id.
- **Removed from a group**: a `my_chat_member` update whose new status is `left` or `kicked` unlinks the chat (for every owner), the same as `/unlink`.
- **Startup**: `setMyCommands` with `start`, `status` and `unlink`, plus `setWebhook` with `allowed_updates: ["message", "my_chat_member"]`. Neither call is awaited, like `setWebhook` today. `docs/deploy.md` drops the manual `/setcommands` step.
- **Alert text**: sent with `parse_mode: "HTML"`. Everything from Users or devices (Monitor name, Heartbeat message) is escaped for Telegram HTML (`&`, `<`, `>`). Down: bold name, "is Down", since when, and the last Heartbeat message if any. Up: bold name, "is Up again", when, how long it was Down. Both end with a link to `PUBLIC_BASE_URL/monitors/<id>`. The text is still built when the Alert is enqueued.
- **Silent Up**: Up Alerts are sent with `disable_notification: true`. This applies to everyone and has no setting.
- **Alert chats**:
  - A Monitor stores either "all Linked chats" (the default for new and existing Monitors) or a list of chosen Linked chats.
  - The Monitor form (create and edit) gets an "All Linked chats" option and a checkbox per Linked chat. Only the owner's Linked chats are accepted.
  - An Alert is addressed to the Monitor's Alert chats at enqueue time. When there are none, no Alert is enqueued, the same as having no Linked chats today.
  - Removing a Linked chat removes it from every chosen list. A Monitor whose list becomes empty keeps the chosen mode with no chats. The Monitor page and the Dashboard show "Alerts go to no chat". It never falls back to "all".
  - `/status` in any chat lists, for each owner linked to it, only the Monitors whose Alert chats include that chat.
- **Unchanged on purpose**: the per-Monitor Alerts on/off switch stays separate from Alert chats. The bot doesn't pause, mute or acknowledge anything.

## Testing Decisions

- Same single seam: `createApp`, Fastify `inject`, the fake clock, real Mongo in memory and the recording Telegram fake.
- The fake records `parse_mode`, `disable_notification`, `setMyCommands` and `allowed_updates`, and can fail a send with `400` + `migrate_to_chat_id`.
- Alerts are checked by the text and options the fake received, including escaping of a Monitor name like `<b>&co</b>`.

## Out of Scope

- Controlling Monitors from Telegram (pause, Alerts off, mute, acknowledge), and linking Telegram people to Users.
- Reminders while a Monitor stays Down, daily digests and quiet hours.
- Forum topics in supergroups.
- Alert channels other than Telegram.

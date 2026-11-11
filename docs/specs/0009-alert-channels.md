# Spec 0009: Alert channels

Status: ready-for-agent

Blocked by: spec 0005 issues 0027–0030 (Telegram changes land first); replaces issue 0031

## Problem Statement

Alerts only go to Telegram. Invited hobbyists who don't use Telegram get no Alerts at all, and people with Home Assistant, n8n or their own scripts can't react to a Monitor going Down. Issue 0031 lets a Monitor pick its Alert chats, but only among Telegram chats, so it would have to be redone once another kind exists.

## Solution

Introduce **Alert channels**: places a User receives Alerts. A Linked chat becomes one kind; two new kinds are added: a **Webhook** (HTTP POST of a JSON body) and an **ntfy topic** (push via ntfy.sh or a self-hosted ntfy). Each Monitor's Alert channels are all of its owner's channels (default, including ones added later) or a chosen few. Every channel can send a test Alert. A channel whose Alerts keep failing is flagged **Failing** but keeps receiving Alerts.

## User Stories

1. As a User, I want to add a Webhook with a URL and an optional secret, so that my own tools get Alerts.
2. As a User, I want each Webhook request signed with my secret, so that my receiver can reject forged Alerts.
3. As a User, I want to add an ntfy topic by its full URL and an optional access token, so that Alerts reach my phone without Telegram.
4. As a User, I want Down Alerts on ntfy sent at high priority and Up Alerts at low priority, so that recoveries don't wake me (matching silent Up Alerts on Telegram).
5. As a User, I want a "Send test" button on each Alert channel, so that I can check my setup without making a Monitor Down.
6. As a User, I want all my Alert channels — Linked chats, Webhooks, ntfy topics — listed together in Settings, with rename and remove, so that I manage them in one place.
7. As a User, I want to choose which Alert channels a Monitor alerts, or "all", so that garden sensors go to the family group and servers to my webhook.
8. As a User, I want a channel added later to get Alerts from "all" Monitors but not from Monitors with a chosen list, so that adding a channel doesn't surprise me.
9. As a User, I want a Monitor with no Alert channels left to say "Alerts go nowhere" on its page and the Dashboard, so that I notice.
10. As a User, I want a channel whose Alerts kept failing to be marked Failing in Settings, with the last error, so that I know to fix it.
11. As a User, I want a Failing channel to clear as soon as one Alert or test gets through, so that the flag tells the truth.
12. As the Admin, I want Webhook and ntfy URLs that resolve to private, loopback or link-local addresses rejected, so that nodbeat can't be used to probe the `edge` network or the VPS.
13. As a User, I want `/status` in a Telegram chat to list only the Monitors whose Alert channels include that chat, so that a family group doesn't see my servers.

## Implementation Decisions

- **Collection `alertChannels`**: `_id`, `ownerId`, `kind` (`telegram` | `webhook` | `ntfy`), `name`, kind-specific config (`chatId`; `url`, `secret`; `url`, `token`), `createdAt`, `failingSince`, `lastError`. Existing `linkedChats` are migrated into it at startup (idempotent); Linked chat code reads from it filtered by `kind: "telegram"`.
- **Monitor field** `alertChannels`: `"all"` or an array of channel ids. Missing → `"all"`. Removing a channel pulls it from every chosen list; an empty list stays chosen.
- **Outbox**: `AlertDoc.chatIds` becomes `channelIds`; the dispatcher picks a sender per kind. Existing retry rules (exponential backoff, 1 hour window) apply per channel; a Telegram `403`/kick still unlinks, a Webhook/ntfy giving up sets `failingSince` + `lastError` instead.
- **Webhook body**: `{"monitor": {"id", "name", "url"}, "kind": "down"|"up", "at": ISO, "message": string|null, "incidentId"}`. Header `X-Nodbeat-Signature: sha256=<hex HMAC of body>` when a secret is set. 5 s timeout; any `2xx` is success. Documented in `api/openapi.yaml` as a webhook.
- **ntfy**: `POST <topic URL>` with title = Monitor name + state, body = Alert text, `Priority: 5` for Down, `2` for Up, `Click: <Monitor URL>`, `Authorization: Bearer <token>` when set.
- **SSRF guard**: on save and on every send, resolve the host and refuse private, loopback, link-local, CGNAT and unique-local addresses (v4 and v6); `https` only, except `http` allowed when the host is public. No redirects followed.
- **Test Alert**: `POST /settings/channels/:id/test`, sent directly (not via outbox), result shown as a Flash message, limited per User (5 per minute).
- **Limits**: max Alert channels per User in `limitsFor` (e.g. 10), checked atomically like the Monitor limit.
- **Secrets** are stored as given (needed to sign) and never shown again after saving; the form shows "secret set".

## Glossary Additions

Already in `GLOSSARY.md`: Alert channel, Alert channels (of a Monitor), Webhook, ntfy topic, Failing.

## Testing Decisions

- Single seam with a fake HTTP sender next to the fake Telegram client.
- Scenarios: Webhook receives a signed Down Alert, signature verifies; ntfy Down has priority 5, Up has 2; webhook to `http://127.0.0.1` or a name resolving to `10.x` rejected on save and on send; failing webhook for an hour → Failing with last error, still in the outbox for the next Alert; test send clears Failing; Monitor with chosen channels alerts only there; channel added later gets Alerts only from "all" Monitors; removing the only chosen channel shows "Alerts go nowhere"; existing Linked chats are migrated and keep alerting; another User's channel id rejected by the Monitor form.

## Out of Scope

- Email, Discord, Slack, SMS as separate kinds (Discord/Slack can use a Webhook-compatible bridge later).
- Per-channel Alert formatting templates.
- Retrying a Failing channel beyond the existing 1-hour window.

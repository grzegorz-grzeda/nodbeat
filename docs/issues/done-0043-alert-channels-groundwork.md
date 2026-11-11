# 0043: Alert channels groundwork

Spec: 0009
Status: resolved

**What to build:** Linked chats become the first kind of Alert channel. Alerts are addressed to Alert channels and sent by a sender per kind. Settings lists all Alert channels in one place. For Users nothing changes yet: Alerts still go to every Linked chat, exactly as today.

**Blocked by:** 0027, 0028, 0029, 0030 (they change the same Telegram and outbox code).

- [ ] Existing Linked chats are moved into Alert channels at startup; running it twice changes nothing
- [ ] Queued Alerts are addressed to Alert channels; the dispatcher picks a sender by kind; retry, backoff and the Telegram unlink-on-kick behaviour are unchanged
- [ ] Linking via Link code, `/unlink`, removal in Settings and bot removal all work on Alert channels
- [ ] Settings shows one "Alert channels" list with kind, name, rename and remove
- [ ] A per-User Alert channel limit, checked atomically like the Monitor limit
- [ ] If issue 0042 has landed: account deletion removes the User's Alert channels of every kind (a Telegram chat shared with another User stays for them), and its confirmation page counts Alert channels
- [ ] Tests through the HTTP seam: a pre-migration Linked chat still receives Down and Up Alerts after startup; linking, renaming and removing a chat; the limit can't be passed with parallel requests

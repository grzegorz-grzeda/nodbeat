# 0031: Alert chats

Spec: 0005
Status: ready-for-agent

**What to build:** Each Monitor chooses its Alert chats: all of the owner's Linked chats (default, including chats linked later) or a chosen few. Alerts and a chat's `/status` follow that choice.

**Blocked by:** none.

- [ ] Monitor stores "all Linked chats" or a list of chosen Linked chats; existing Monitors read as "all"
- [ ] Monitor create and edit forms: "All Linked chats" option plus a checkbox per Linked chat; only the owner's Linked chats accepted
- [ ] An Alert is addressed to the Monitor's Alert chats at enqueue time; none → no Alert enqueued
- [ ] Removing a Linked chat (Settings, `/unlink`, 403, bot removed) takes it out of every chosen list; an empty list stays chosen, never falls back to "all"
- [ ] Monitor page and Dashboard show "Alerts go to no chat" for a Monitor with no Alert chats
- [ ] `/status` in a chat lists, per owner, only the Monitors whose Alert chats include that chat
- [ ] Tests through the HTTP seam: a Monitor alerting one of two chats sends only there; a chat linked later gets Alerts from "all" Monitors and not from chosen ones; removing the only chosen chat shows the warning and sends nothing; a group's `/status` lists only its Monitors; another User's Linked chat id is rejected by the form

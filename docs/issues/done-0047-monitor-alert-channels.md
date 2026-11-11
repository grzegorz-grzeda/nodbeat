# 0047: Monitor's Alert channels

Spec: 0009
Status: resolved

**What to build:** Each Monitor chooses its Alert channels: all of its owner's Alert channels (default, including ones added later) or a chosen few. Alerts and a Telegram chat's `/status` follow that choice. Replaces issue 0031.

**Blocked by:** 0043.

- [ ] Monitor create and edit forms: "All Alert channels" or a checkbox per channel; only the owner's channels accepted; existing Monitors read as "all"
- [ ] An Alert is addressed to the Monitor's Alert channels when queued; none → nothing queued
- [ ] Removing a channel takes it out of every chosen list; an empty list stays chosen, never falls back to "all"
- [ ] Monitor page and Dashboard show "Alerts go nowhere" for a Monitor with no Alert channels
- [ ] `/status` in a chat lists, per owner, only the Monitors whose Alert channels include that chat
- [ ] Tests through the HTTP seam: a Monitor alerting one of two channels sends only there; a channel added later gets Alerts from "all" Monitors only; removing the only chosen channel shows the warning and sends nothing; a group's `/status` lists only its Monitors; another User's channel id rejected

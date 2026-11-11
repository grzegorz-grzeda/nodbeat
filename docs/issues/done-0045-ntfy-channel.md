# 0045: ntfy channel

Spec: 0009
Status: resolved

**What to build:** A User adds an ntfy topic by its full URL (ntfy.sh or self-hosted) with an optional access token. Down Alerts arrive at high priority, Up Alerts at low priority, each linking to its Monitor.

**Blocked by:** 0044 (private-address guard and Failing).

- [ ] Add and edit an ntfy topic in Settings; the token is never shown again after saving
- [ ] Alerts are POSTed with the Monitor name and state as title, priority 5 for Down and 2 for Up, a click link to the Monitor page, and `Authorization: Bearer` when a token is set
- [ ] The same private-address guard and Failing behaviour as Webhooks
- [ ] If issue 0046 has landed: "Send test" works for ntfy topics
- [ ] Tests through the HTTP seam: Down has priority 5, Up 2; token sent; private address rejected; failures → Failing

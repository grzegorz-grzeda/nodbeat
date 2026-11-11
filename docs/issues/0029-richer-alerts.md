# 0029: Richer Alerts

Spec: 0005
Status: ready-for-agent

**What to build:** Alerts are formatted in Telegram HTML with the Monitor name in bold, a Down Alert carries the last Heartbeat message, and every Alert links to its Monitor page.

**Blocked by:** none.

- [ ] `sendMessage` takes options; Alerts are sent with `parse_mode: "HTML"` (bot command replies stay plain text)
- [ ] Monitor name and Heartbeat message escaped for Telegram HTML (`&`, `<`, `>`)
- [ ] Down: bold name, "is Down", since when (User's time zone), last Heartbeat message if any
- [ ] Up: bold name, "is Up again", when, how long it was Down
- [ ] Both end with a link to `PUBLIC_BASE_URL/monitors/<id>`
- [ ] The text is still built when the Alert is enqueued (not at send time)
- [ ] Tests through the HTTP seam: the fake receives the HTML text with the message and link; a Monitor named `<b>&co</b>` arrives escaped

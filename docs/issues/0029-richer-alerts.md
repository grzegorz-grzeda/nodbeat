# 0029: Richer Alerts

Spec: 0005
Status: ready-for-agent

**What to build:** Alerts are formatted in Telegram HTML with the Monitor name in bold, a Down Alert carries the last Heartbeat message, and every Alert links to its Monitor page.

**Blocked by:** none.

- [x] `sendMessage` takes options; Alerts are sent with `parse_mode: "HTML"` (bot command replies stay plain text)
- [x] Monitor name and Heartbeat message escaped for Telegram HTML (`&`, `<`, `>`)
- [x] Down: bold name, "is Down", since when (User's time zone), last Heartbeat message if any
- [x] Up: bold name, "is Up again", when, how long it was Down
- [x] Both end with a link to `PUBLIC_BASE_URL/monitors/<id>`
- [x] The text is still built when the Alert is enqueued (not at send time)
- [x] Tests through the HTTP seam: the fake receives the HTML text with the message and link; a Monitor named `<b>&co</b>` arrives escaped

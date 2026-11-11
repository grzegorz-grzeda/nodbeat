# 0034: Heartbeat clients on the Admin page

Spec: 0006
Status: done

**What to build:** Heartbeats record a trimmed User-Agent, and the Admin page shows how last-7-day Heartbeats arrive: GET vs POST, with a message, and grouped by client.

**Blocked by:** 0032.

- [x] Heartbeat doc gets `userAgent: string | null`, the `User-Agent` header trimmed to 200 characters; old docs count as "none"
- [x] One function maps a User-Agent to a client group: curl, wget, Python, ESP32/Arduino, browser, other, none (substring rules from spec 0006)
- [x] Shares of GET vs POST and of Heartbeats with a message
- [x] Raw User-Agent strings and messages are never shown
- [x] Tests through the HTTP seam: Heartbeats with `curl/8.5.0`, `ESP32HTTPClient`, `python-requests/2.32`, a browser UA and none, GET and POST, with and without messages → expected groups and shares; a message with a unique marker never appears

# 0035: Per-User table on the Admin page

Spec: 0006
Status: done

**What to build:** The Admin page lists every User with their Monitor count, Linked chat count, Heartbeats in the last 7 days and the time of their last Heartbeat.

**Blocked by:** 0032.

- [x] One row per User: email, Monitors, Linked chats, Heartbeats (7 days), last Heartbeat in the Admin's time zone ("never" when none)
- [x] Sorted by last Heartbeat, newest first; Users without one last
- [x] Tests through the HTTP seam: three Users with different activity → rows in the expected order with the expected counts; no Monitor names or Linked chat titles shown

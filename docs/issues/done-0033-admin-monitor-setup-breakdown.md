# 0033: Monitor setup breakdown on the Admin page

Spec: 0006
Status: done

**What to build:** The Admin page shows how Monitors are set up: grouped by Interval, and the share with a custom Grace period, notes, Alerts off and Paused.

**Blocked by:** 0032.

- [x] Interval groups: ≤ 1 min, ≤ 5 min, ≤ 1 h, ≤ 1 day, > 1 day
- [x] "Custom Grace period" = differs from the default (half the Interval, clamped to the Grace bounds in `src/limits.ts`); the default rule lives in one place shared with the Monitor form
- [x] Shares of Monitors with a custom Grace period, with notes, with Alerts off, Paused
- [x] Notes are counted, never shown
- [x] Tests through the HTTP seam: Monitors at 30 s, 5 min, 2 h and 3 days with mixed settings → expected groups and shares; a note with a unique marker never appears

# Spec 0015: Plans and limits

Status: ready-for-agent

Blocked by: none

## Problem Statement

Every User gets the same limits (`limitsFor` ignores the User). To sell anything, nodbeat needs a Free Plan that's useful on its own and a Pro Plan worth paying for, both enforced, before any payment exists. Existing invited Users are used to 50 Monitors and must not lose anything overnight.

## Solution

Each User is on a **Plan**: **Free** or **Pro**. The Plan decides the limits below. The Admin can give a User Pro until a date (a comp); spec 0016 will add paid Pro through Stripe. When Pro ends, nothing the User built is deleted: over-limit Monitors keep working, and Pro-only features keep working for 14 more days, with warnings, before they stop. On a self-hosted instance without billing configured, Plans don't apply and today's limits stay.

|                             | Free                      | Pro        |
| --------------------------- | ------------------------- | ---------- |
| Monitors                    | 10                        | 100        |
| Shortest Interval           | 1 min                     | 30 s       |
| Alert channels              | Linked chats, ntfy topics | + Webhooks |
| Reminders                   | no                        | yes        |
| Heartbeats kept per Monitor | 50                        | 1000       |
| Incidents kept per Monitor  | 50                        | 500        |
| Longest Heartbeat age kept  | 7 days                    | 90 days    |

## User Stories

1. As a User, I want Settings to show my Plan, its limits and my usage (e.g. "7 of 10 Monitors"), so that I know where I stand.
2. As a Free User, I want creating an 11th Monitor, a Webhook, a 30 s Interval or Reminders to be refused with a "Needs Pro" message, so that I know what Pro gives me.
3. As a Free User, I want my logs kept to 50 Heartbeats and 50 Incidents per Monitor, so that Free is cheap to run.
4. As a Pro User, I want 1000 Heartbeats (up to 90 days) and 500 Incidents per Monitor, so that I can look further back.
5. As the Admin, I want to give a User Pro until a date, and to end it, from the per-User table, so that I can comp friends and beta testers.
6. As an existing User when this ships, I want Pro for 6 months, so that nothing I have breaks and I can try Pro.
7. As a User whose Pro ended, I want Monitors over the Free limit to keep running and alerting (I just can't add more), so that ending Pro never silences a Monitor.
8. As a User whose Pro ended, I want Webhooks, Reminders and 30 s Intervals to keep working for 14 days and a banner plus an Alert to my Alert channels at the start and on day 12, so that I'm never cut off without warning.
9. As a User 14 days after Pro ended, I want Webhooks shown "Needs Pro" (no longer sent to, but not deleted), Reminders off, and 30 s Monitors moved to 1 min, so that I can get everything back by upgrading.
10. As a User whose logs were trimmed after Pro ended, I want Uptime unchanged, so that history I see stays honest.
11. As the Admin, I want the Admin page to count Users per Plan, so that I see how many pay.
12. As a self-hosting Operator without billing configured, I want no Plans anywhere in the UI and the current limits, so that the open-source version isn't crippled.

## Implementation Decisions

- **User fields**: `plan: { proUntil: Date | null, source: "comp" | "stripe" | null, proEndedAt: Date | null }`. Effective Plan = Pro while `proUntil > now`, else Free. Spec 0016 sets `proUntil` to the Stripe subscription's period end; this spec only has comps.
- **Single lookup**: `limitsFor(owner, now)` returns limits from the effective Plan, plus `features: { webhooks, reminders }`. Every check goes through it, keyed by owner, so a later Team could own a Plan (Teams are out of scope).
- **Plans off**: when billing isn't configured (spec 0016's env vars), `limitsFor` returns today's `DEFAULT_LIMITS` with all features on, and Plan UI is hidden. This spec ships behind a temporary `PLANS_ENABLED` flag until spec 0016 exists.
- **Enforcement points**: Monitor create (count), Monitor create/edit (Interval, Reminders), Alert channel create (Webhook kind). Edits that don't touch a limited field always succeed, so an over-limit Monitor stays editable.
- **Downgrade**: on the down-checker tick, Users whose Pro ended get `proEndedAt` set and a "Pro ended" account notice; at +12 days a second notice; at +14 days the dormant step runs once: Webhook channels flagged `needsPro` (the Alert dispatcher skips them), Reminders cleared, 30 s Intervals raised to 60 s (Monitor keeps its deadline logic via the normal edit path). Upgrading clears `needsPro`; Reminders and Intervals are not restored automatically.
- **Account notices**: a new Alert kind `notice` about no Monitor, sent to all the User's Alert channels like a Test Alert (but retried), plus a banner on every page until dismissed.
- **Logs**: `maxLogRowsPerMonitor` splits into `maxHeartbeatsPerMonitor` and `maxIncidentsPerMonitor`, read per owner by the log pruner. The instance-wide Heartbeat TTL index becomes a TTL on a per-document `expiresAt` set at intake from the owner's Plan (still one insert). Incidents still survive while 7-day Uptime needs them.
- **Migration**: on first start with Plans enabled, every existing User gets Pro, `source: "comp"`, `proUntil` = now + 6 months. New Users start Free.
- **Admin**: per-User table gets a Plan column and "Give Pro until…" / "End Pro" actions (confirmation pages, like Invite revoke).

## Glossary Additions

- **Plan** (already added). Consider **Comp** if the term sticks.

## Testing Decisions

- Single seam, fake clock. Scenarios: Free User refused at 11th Monitor, 30 s Interval, Webhook, Reminders; Admin gives Pro → allowed; advance past `proUntil` → notice to Alert channels and banner, Webhook still sent; +12 d second notice; +14 d Webhook skipped and shown "Needs Pro", Reminders off, 30 s → 60 s; over-limit Monitors still go Down and alert; Free log trimmed to 50 on next prune, Uptime unchanged; migration gives existing Users 6 months of Pro once; Plans off → current limits, no Plan UI.

## Out of Scope

- Payments (spec 0016).
- Teams and shared Monitors.
- Trials.
- Per-Plan Alert channel counts beyond today's 10.

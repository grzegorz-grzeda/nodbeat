# 0068: Daily Stripe reconcile

Spec: 0016
Status: ready-for-agent

**What to build:** Once a day nodbeat re-reads the subscriptions of Pro Users with `source: "stripe"`, so a missed webhook can't leave a Plan wrong.

**Blocked by:** 0066

- [ ] Daily on the tick; updates `plan` like the webhook handler does
- [ ] Test: subscription cancelled in the fake Stripe with no webhook → Plan corrected after the daily reconcile

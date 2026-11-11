# 0070: Account deletion cancels the subscription

Spec: 0016
Status: ready-for-agent

**What to build:** Deleting a Pro User's account cancels their Stripe subscription at once, before any data is deleted, with no refund. The confirmation page says so.

**Blocked by:** 0065, 0042

- [ ] Subscription cancelled first, no proration; if the cancel fails, nothing is deleted
- [ ] The confirmation page warns about the cancellation for Pro Users
- [ ] Tests: deletion cancels in the fake Stripe before data goes; cancel failure → nothing deleted

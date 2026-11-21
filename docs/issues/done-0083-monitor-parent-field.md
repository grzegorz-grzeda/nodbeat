# 0083: Set a Monitor's Parent

Spec: 0022
Status: resolved

**What to build:** A User picks a Monitor's Parent ("Depends on") on the Monitor form or through the API. No Alert behaviour changes yet.

**Blocked by:** None (can start immediately)

- [x] `parentId: ObjectId | null` on Monitor, default `null`
- [x] "Depends on" select on the Monitor form; same User only, not itself, no cycles (chains allowed)
- [x] ~~Monitor API~~: there is no Monitor API (the API covers Heartbeats and Webhooks only), so nothing to change
- [x] Deleting a Monitor sets its Children's `parentId` to `null`
- [x] Monitor page lists its Children
- [x] Tests for each point
- [x] "Download my data" (issue 0075) doesn't exist yet; nothing to change

## Comments

- Cycle checks run per edit without an owner-wide lock, so two simultaneous edits could still store a cycle. Anything that walks a chain of Parents (issues 0084, 0085) must stop at a Monitor it has already seen.

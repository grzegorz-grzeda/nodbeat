# 0087: Parents are Pro-only

Spec: 0022
Status: ready-for-agent

**What to build:** With Plans on, only Pro Users can set a Parent. After a downgrade the Parent is kept but ignored and works again on upgrade. With Plans off, always available.

**Blocked by:** 0083, 0060

- [ ] Setting a Parent on Free (form and API) refused with "Needs Pro"; edits not touching `parentId` still succeed
- [ ] Free User's kept `parentId` treated as no Parent; form shows "Depends on needs Pro"
- [ ] Losing Pro with Unreachable Children gives them a fresh deadline (as when the Parent stops counting)
- [ ] Plans off → available to everyone
- [ ] Tests for each point

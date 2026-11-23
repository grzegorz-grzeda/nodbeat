# 0087: Parents are Pro-only

Spec: 0022
Status: done

**What to build:** With Plans on, only Pro Users can set a Parent. After a downgrade the Parent is kept but ignored and works again on upgrade. With Plans off, always available.

**Blocked by:** 0083, 0060

- [x] Setting a Parent on Free (form and API) refused with "Needs Pro"; edits not touching `parentId` still succeed
- [x] Free User's kept `parentId` treated as no Parent; form shows "Depends on needs Pro"
- [x] Losing Pro with Unreachable Children gives them a fresh deadline (as when the Parent stops counting)
- [x] Plans off → available to everyone
- [x] Tests for each point

## Comments

- New Plan feature `parents`. There is no Monitor API, so only the form refuses. The down checker looks up the owner's Plan per Child with a Parent; a Parent off the Plan reads as "no Parent", which already gives an Unreachable Child a fresh deadline (as a Paused Parent does).

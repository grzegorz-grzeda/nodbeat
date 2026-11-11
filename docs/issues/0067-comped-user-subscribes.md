# 0067: Comped User subscribes without a gap

Spec: 0016
Status: ready-for-agent

**What to build:** A comped Pro User subscribes before their comp ends and billing starts when the comp ends: no gap, no double time.

**Blocked by:** 0065, 0061

- [ ] Checkout for a comped User sets `trial_end` = comp end
- [ ] Test: comped User checkout carries `trial_end`; after the webhook the User stays Pro through comp end and on into the paid period

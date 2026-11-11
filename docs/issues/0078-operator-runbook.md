# 0078: Operator runbook

Spec: 0019
Status: ready-for-agent

**What to build:** The Operator has one runbook in `docs/` for breaches, support, refunds and the records GDPR expects them to keep, plus the checklist of what the legal text must contain.

**Blocked by:** None (can start immediately).

- [ ] `docs/runbook.md`, for the Operator
- [ ] Breach: what to check, contain, UODO notification within 72 h, telling affected Users, recording the breach
- [ ] Support: contact email, reply within 2 business days
- [ ] Refunds: consumer refund within 14 days, by hand in the Stripe Dashboard (and that it ends Pro through `subscription.deleted`)
- [ ] Yearly: renew `security.txt` `Expires` with a release; review subprocessors
- [ ] Records checklist: record of processing activities, signed DPAs per subprocessor
- [ ] Legal-text content checklist from spec 0014 (UŚUDE art. 8, Art. 28 processor terms, 14-day refund, DSA contact point, Privacy policy contents)

# 0066: Manage billing and follow subscription changes

Spec: 0016
Status: ready-for-agent

**What to build:** A Pro User opens "Manage billing" (Stripe Customer Portal) to change card, switch monthly/yearly, see invoices or cancel, and nodbeat follows subscription changes: cancel → Pro until period end then the spec 0015 downgrade; failed payment → still Pro while Stripe retries.

**Blocked by:** 0065, 0064

- [ ] `POST /billing/portal` creates a Portal Session and redirects
- [ ] `customer.subscription.updated|deleted`: `active`/`trialing`/`past_due` → Pro until `current_period_end`; `canceled`/`unpaid` → Pro ends
- [ ] Tests: `cancel_at_period_end` → Pro until period end, then downgrade notices; `past_due` → still Pro; `deleted` → Pro ends

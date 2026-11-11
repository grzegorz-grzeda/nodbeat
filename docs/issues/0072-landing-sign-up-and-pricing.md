# 0072: Landing page sign-up and pricing

Spec: 0017
Status: ready-for-agent

**What to build:** The landing page drops "invite-only for now", gets a "Sign up free" button and a pricing section comparing Free and Pro with prices from Stripe.

**Blocked by:** 0071, 0065

- [ ] "Sign up free" shown only when sign-up is open
- [ ] Pricing section compares Free and Pro limits, prices read from the Stripe prices at startup (EUR and USD)
- [ ] No pricing section when billing is off
- [ ] Tests through the HTTP seam with the fake StripeClient

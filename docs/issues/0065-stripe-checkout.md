# 0065: Upgrade to Pro with Stripe Checkout

Spec: 0016
Status: ready-for-agent

**What to build:** A Free User clicks "Upgrade to Pro" in Settings, pays monthly or yearly on Stripe Checkout, and Stripe's webhook makes them Pro. Billing config replaces `PLANS_ENABLED`.

**Blocked by:** 0060, 0057 (Terms accepted before charging)

- [ ] `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`: all set → billing and Plans on; none → off; some → startup error
- [ ] Injected `StripeClient` using plain `fetch`, fake in tests
- [ ] `POST /billing/checkout` (CSRF) creates a subscription Checkout Session with `automatic_tax`, `tax_id_collection`, `client_reference_id` = User id; Customer created on first checkout, `stripeCustomerId` stored; `303` redirect
- [ ] `POST /stripe/webhook` with raw body, `Stripe-Signature` verified (5 min tolerance); bad signature → `400`
- [ ] `checkout.session.completed` and `customer.subscription.created` → Pro until period end, `source: "stripe"`; event ids in `stripe_events` (TTL 30 d), replays change nothing
- [ ] The return URL never grants Pro by itself
- [ ] Tests for each point

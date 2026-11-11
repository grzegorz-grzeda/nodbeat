# Spec 0016: Stripe billing

Status: needs-triage

Blocked by: spec 0014 (Terms and Privacy), spec 0015 (Plans and limits), spec 0018 (Download my data), spec 0019 (Compliance basics)

## Problem Statement

Plans exist, but the only way to get Pro is the Admin. To learn whether anyone pays, a User needs to buy Pro, manage it and cancel it themselves, while nodbeat stays invite-only and never touches card data.

## Solution

Pro is sold through Stripe directly (ADR 0007): about €4/month or €40/year, also in USD. "Upgrade to Pro" in Settings opens Stripe Checkout; "Manage billing" opens the Stripe Customer Portal (card, cancel, switch monthly/yearly, invoices). Stripe Tax adds the right VAT and collects business VAT IDs. Stripe webhooks keep the User's Plan in sync.

## User Stories

1. As a Free User, I want "Upgrade to Pro" with monthly and yearly prices in EUR or USD, so that I can pay how I like.
2. As a buyer, I want to pay on Stripe's page and be back in nodbeat with Pro active, so that it just works.
3. As a business buyer, I want to give my VAT ID at checkout, so that I'm charged the right VAT.
4. As a Pro User, I want "Manage billing" to change my card, switch between monthly and yearly, see receipts, and cancel, so that I don't have to ask anyone.
5. As a Pro User who cancels, I want Pro until the end of the paid period, then the downgrade from spec 0015, so that I get what I paid for.
6. As a Pro User whose payment fails, I want Pro to stay while Stripe retries, and Stripe's emails telling me, so that a card expiry doesn't cut me off at once.
7. As a comped Pro User (spec 0015), I want to subscribe before my comp ends, starting billing when the comp ends, so that there's no gap and no double time.
8. As the Admin, I want the Admin page to show paying Users and monthly recurring revenue, so that I know if this works.
9. As the owner, I want every Stripe event handled idempotently and verified by signature, so that replays or forged requests can't change Plans.

## Implementation Decisions

- **Config**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY` (prices carry EUR + USD currency options). All set → billing and Plans on (replaces `PLANS_ENABLED`); none → off; some → startup error.
- **Client**: plain `fetch` to the Stripe REST API, no SDK, behind an injected `StripeClient` like the Telegram client.
- **Checkout**: `POST /billing/checkout` (CSRF) creates a Checkout Session (mode `subscription`, `automatic_tax`, `tax_id_collection`, `client_reference_id` = User id, `trial_end` = comp end when comped) and redirects with `303`. Customer created on first checkout; `users.stripeCustomerId` stored.
- **Portal**: `POST /billing/portal` creates a Portal Session and redirects.
- **Webhook**: `POST /stripe/webhook`, raw body, `Stripe-Signature` verified with the secret and a 5-min tolerance. Handles `checkout.session.completed`, `customer.subscription.created|updated|deleted`. Each sets `plan` from the subscription's status and `current_period_end` (`active`/`trialing`/`past_due` → Pro until period end; `canceled`/`unpaid` → Pro ends). Event ids stored in `stripe_events` (TTL 30 days) for idempotency. The return URL after checkout never grants Pro by itself.
- **Reconcile**: once a day the tick re-reads subscriptions of Pro Users with `source: "stripe"`, in case a webhook was missed.
- **Account deletion** (spec 0012): cancels the subscription first, no proration.
- **CSP**: no Stripe scripts; only redirects to Stripe-hosted pages.
- **KSeF / Polish B2B invoices**: out of nodbeat; the owner issues them in the accounting tool from Stripe's payout reports.

## Testing Decisions

- Single seam with a fake `StripeClient` and signed fake webhook events. Scenarios: checkout redirect carries the User id and price; `checkout.session.completed` + `subscription.created` → Pro; replayed event → no change; bad signature → `400`, no change; `subscription.updated` with `cancel_at_period_end` → Pro until period end, then spec 0015 downgrade; `past_due` → still Pro; `deleted` → Pro ends; comped User checkout sets `trial_end` = comp end; billing env partly set → startup error; none set → no billing UI, Plans off.

## Out of Scope

- Merchant of Record (ADR 0007).
- Coupons, lifetime deals, Teams pricing, PLN prices.
- Issuing KSeF invoices from nodbeat.
- Opening sign-up (spec 0017).

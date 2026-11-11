# Stripe direct, not a Merchant of Record

Pro is sold through Stripe directly (Checkout, Customer Portal, Stripe Tax), with G2Labs as the seller. A Merchant of Record (Paddle, Lemon Squeezy, Polar) would be the seller instead and take over EU VAT, invoices and refunds, but it charges about 5% + a fee per sale against Stripe's ~1.5–3% + 0.5% for Stripe Tax, and it puts a third party between nodbeat and its paying Users. The owner takes on the tax side to keep fees low and own the customer relationship.

## Considered Options

- **Merchant of Record (Paddle / Lemon Squeezy / Polar)**: rejected. Least paperwork, but highest fees, and switching later means moving every subscription.

## Consequences

- G2Labs registers for VAT OSS and files it; Stripe Tax computes the VAT per country at checkout.
- Stripe's receipts are enough for consumers. Polish business buyers need a VAT invoice in KSeF, which Stripe can't issue: those are made in the owner's accounting tool, by hand while volume is low.
- Card data never touches nodbeat: payment happens on Stripe-hosted pages only.
- Moving to a Merchant of Record later means asking every Pro User to subscribe again.
